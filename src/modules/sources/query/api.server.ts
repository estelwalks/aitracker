import type { UsageSourcesSummary } from "../../../lib/local-usage/get-usage-sources";
import type { SkillSnapshotData } from "../../skill-catalog";
import { SKILL_AGENTS } from "../../../lib/local-skills/types";
import { AI_TOOLS } from "../../../lib/tools/catalog";
import { osFromProcess } from "../../../lib/tools/detection.server";
import { sourcePathsForPlatform } from "../../../lib/local-usage/source-paths";
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

function countSkillsByAgent(snapshot: SkillSnapshotData): Map<string, number> {
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
  skills: SkillSnapshotData,
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
        // Installation snapshots contain the paths that happened to exist at
        // scan time. The Sources page must always show the platform-specific
        // catalog paths as well, including not-installed agents, so users can
        // locate their data before the first scan.
        paths: sourcePathsForPlatform(
          entry.id,
          osFromProcess(process.platform),
          process.env.HOME ?? process.env.USERPROFILE ?? "",
          process.env,
        ),
        skillCount:
          skillAgent == null ? null : (countByAgent.get(skillAgent) ?? 0),
        skillAgent,
      };
    }),
  });
}

export async function getSourcesQuery(): Promise<SourcesQuerySummary> {
  const [usage, skills] = await Promise.all([
    readSourcesFromSnapshot(),
    readSkillsFromSnapshot(),
  ]);
  return projectSources(usage, skills);
}

/**
 * T4-01 (fix): non-blocking refresh command. The Usage/Installation snapshot
 * coordinators run the scans in the background (single-flight); the response
 * returns the latest known projection immediately so the page never waits for
 * a scan. The list becomes eventually consistent once the refresh commits.
 */
export async function refreshSourcesQuery(): Promise<SourcesQuerySummary> {
  void refreshSourcesFromSnapshot().catch(() => {});
  return getSourcesQuery();
}

/**
 * T7-08: Skills read the O(1) skill snapshot (never a scan on the page path).
 * An empty snapshot triggers one NON-BLOCKING background refresh, then
 * degrades to an empty view (design §4.3 / G4).
 */
async function readSkillsFromSnapshot(): Promise<SkillSnapshotData> {
  const { getCompositionRoot } =
    await import("../../../app/composition.server.ts");
  const { skillSnapshot } = await getCompositionRoot();
  await skillSnapshot.ensureHydrated();
  let latest = skillSnapshot.readLatest();
  if (latest.data == null) {
    // T3-11: empty-state refresh through the unified task runtime.
    void skillSnapshot.requestRefresh({ reason: "empty" }).catch(() => {});
    latest = skillSnapshot.readLatest();
  }
  return (
    latest.data ?? {
      generatedAt: new Date(0).toISOString(),
      fingerprint: "",
      roots: {},
      agents: {},
      skills: [],
      blacklist: [],
    }
  );
}

/**
 * P4-T4-01 / P3-T3-03: Sources reads the unified Usage + Installation
 * snapshots (O(1), never scans and never re-probes tool roots). Snapshot
 * absence degrades to an empty summary.
 */
async function readSourcesFromSnapshot(): Promise<UsageSourcesSummary> {
  const { getCompositionRoot } =
    await import("../../../app/composition.server.ts");
  const { usageSnapshot, installationSnapshot } = await getCompositionRoot();
  await usageSnapshot.ensureHydrated();
  await installationSnapshot.ensureHydrated();
  const latest = usageSnapshot.readLatest();
  const installations = installationSnapshot.readLatest();
  const { deriveUsageSources } =
    await import("../../../lib/local-usage/get-usage-sources");
  const { homedir } = await import("node:os");
  const homeDirectory = homedir();
  // InstallationSnapshot facts use `~/`-relative display paths; deriveUsageSources
  // normalizes them again idempotently, so the snapshot's paths feed directly.
  const installationFacts = (installations.data?.facts ?? []).map((fact) => ({
    id: fact.id,
    installed: fact.installed,
    detectedPaths: [...fact.paths],
  }));
  return deriveUsageSources(
    AI_TOOLS,
    latest.data?.sources ?? [],
    installationFacts,
    latest.generatedAt ?? latest.lastSuccessAt ?? new Date(0).toISOString(),
    homeDirectory,
  );
}

/** Fire-and-forget refresh of the Usage + Installation snapshots. */
async function refreshSourcesFromSnapshot(): Promise<void> {
  const { getCompositionRoot } =
    await import("../../../app/composition.server.ts");
  const { usageSnapshot, installationSnapshot } = await getCompositionRoot();
  // P3-T3-11: manual refresh goes through the unified task runtime so it is
  // single-flighted against scheduled runs, recorded in the run store and
  // subject to the heavy-collector budget.
  void usageSnapshot.requestRefresh({ reason: "manual" }).catch(() => {});
  void installationSnapshot
    .requestRefresh({ reason: "manual" })
    .catch(() => {});
}
