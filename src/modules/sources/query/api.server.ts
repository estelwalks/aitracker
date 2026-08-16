import {
  getUsageSources,
  refreshUsageSources,
  type UsageSourcesSummary,
} from "../../../lib/local-usage/get-usage-sources";
import { getLocalSkills } from "../../../lib/local-skills/server-fns";
import { SKILL_AGENTS } from "../../../lib/local-skills/types";
import { AI_TOOLS } from "../../../lib/tools/catalog";
import {
  toSourcesQuerySummary,
  type SourcesQuerySummary,
} from "./presentation/model";

/**
 * Skill-agent label of a tool id: the registry display name (`AI_TOOLS[].nameZh`)
 * when it is one of the managed SKILL_AGENTS, else null (no Skill root).
 */
function skillAgentLabelFor(toolId: string): string | null {
  const tool = AI_TOOLS.find((candidate) => candidate.id === toolId);
  return tool != null && SKILL_AGENTS.includes(tool.nameZh)
    ? tool.nameZh
    : null;
}

function countSkillsByAgent(
  snapshot: Awaited<ReturnType<typeof getLocalSkills>>,
): Map<string, number> {
  const countByAgent = new Map<string, number>();
  for (const skill of snapshot.skills) {
    for (const installation of skill.installations) {
      countByAgent.set(
        installation.agent,
        (countByAgent.get(installation.agent) ?? 0) + 1,
      );
    }
  }
  return countByAgent;
}

function projectSources(
  usage: UsageSourcesSummary,
  skills: Awaited<ReturnType<typeof getLocalSkills>>,
): SourcesQuerySummary {
  const countByAgent = countSkillsByAgent(skills);
  return toSourcesQuerySummary({
    ...usage,
    entries: usage.entries.map((entry) => {
      // Skill scanner agent labels are registry-derived display names. Do not
      // invent a name normalization: if there is no exact agent mapping, surface
      // the count as unavailable instead of an unreliable zero.
      const skillAgent = skillAgentLabelFor(entry.id);
      return {
        ...entry,
        skillCount:
          skillAgent == null ? null : (countByAgent.get(skillAgent) ?? 0),
        skillAgent,
      };
    }),
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
