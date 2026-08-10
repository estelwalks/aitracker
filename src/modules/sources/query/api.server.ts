import {
  getUsageSources,
  refreshUsageSources,
  type UsageSourcesSummary,
} from "../../../lib/local-usage/get-usage-sources";
import { getLocalSkills } from "../../../lib/local-skills/server-fns";
import { AI_TOOLS } from "../../../lib/tools/catalog";
import {
  toSourcesQuerySummary,
  type SourcesQuerySummary,
} from "./presentation/model";

function countSkillBindings(
  snapshot: Awaited<ReturnType<typeof getLocalSkills>>,
): ReadonlyMap<string, number | null> {
  const countByAgent = new Map<string, number>();
  for (const skill of snapshot.skills) {
    for (const installation of skill.installations) {
      countByAgent.set(
        installation.agent,
        (countByAgent.get(installation.agent) ?? 0) + 1,
      );
    }
  }

  // Skill scanner agent labels are registry-derived display names. Do not
  // invent a name normalization: if there is no exact agent mapping, surface
  // the count as unavailable instead of an unreliable zero.
  return new Map(
    AI_TOOLS.map((tool) => [
      tool.id,
      Object.hasOwn(snapshot.agents, tool.nameZh)
        ? (countByAgent.get(tool.nameZh) ?? 0)
        : null,
    ]),
  );
}

function projectSources(
  usage: UsageSourcesSummary,
  skills: Awaited<ReturnType<typeof getLocalSkills>>,
): SourcesQuerySummary {
  const skillCounts = countSkillBindings(skills);
  return toSourcesQuerySummary({
    ...usage,
    entries: usage.entries.map((entry) => ({
      ...entry,
      skillCount: skillCounts.get(entry.id) ?? null,
    })),
  });
}

export async function getSourcesQuery(): Promise<SourcesQuerySummary> {
  const [usage, skills] = await Promise.all([
    getUsageSources(),
    getLocalSkills(),
  ]);
  return projectSources(usage, skills);
}

export async function refreshSourcesQuery(): Promise<SourcesQuerySummary> {
  const [usage, skills] = await Promise.all([
    refreshUsageSources(),
    getLocalSkills(),
  ]);
  return projectSources(usage, skills);
}
