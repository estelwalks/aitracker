import type { LocalSkill, SkillAgent, SkillSnapshot } from "../query.ts";

export type AssetSourceFilter = "all" | "frontmatter" | "market" | "unknown";
export type AssetUpdateFilter = "all" | "available" | "current" | "unknown";
export type AssetSortKey = "name" | "lastUsedAt" | "modifiedAt";
export type AssetSortDirection = "asc" | "desc";

export interface SkillAssetView extends LocalSkill {
  readonly sourceKinds: readonly Exclude<AssetSourceFilter, "all">[];
  readonly versions: readonly string[];
  readonly latestModifiedAt: string | null;
  readonly updateStatus: Exclude<AssetUpdateFilter, "all">;
  readonly installedAgents: readonly SkillAgent[];
}

export interface SkillAssetSummary {
  readonly skillCount: number;
  readonly installationCount: number;
  readonly availableAgentCount: number;
  readonly detectedAgentCount: number;
  readonly lastScannedAt: string;
}

export interface SkillAssetFilters {
  readonly text: string;
  readonly agent: "all" | SkillAgent;
  readonly source: AssetSourceFilter;
  readonly updateStatus: AssetUpdateFilter;
  readonly sort: AssetSortKey;
  readonly direction: AssetSortDirection;
}

function dateValue(value: string | null): number | null {
  if (value == null) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function newestTimestamp(values: readonly (string | null)[]): string | null {
  return values.reduce<string | null>((latest, value) => {
    const timestamp = dateValue(value);
    if (timestamp == null) return latest;
    return timestamp > (dateValue(latest) ?? Number.NEGATIVE_INFINITY)
      ? value
      : latest;
  }, null);
}

function aggregateUpdateStatus(
  skill: LocalSkill,
): Exclude<AssetUpdateFilter, "all"> {
  const statuses = skill.installations.map(
    (installation) => installation.updateStatus,
  );
  if (statuses.includes("available")) return "available";
  if (statuses.includes("unknown")) return "unknown";
  return "current";
}

export function toSkillAssetView(skill: LocalSkill): SkillAssetView {
  const sourceKinds = [
    ...new Set(
      skill.installations.map(
        (installation) => installation.source?.kind ?? "unknown",
      ),
    ),
  ] as SkillAssetView["sourceKinds"];
  return {
    ...skill,
    sourceKinds,
    versions: [
      ...new Set(
        skill.installations.flatMap((installation) =>
          installation.version == null ? [] : [installation.version],
        ),
      ),
    ],
    latestModifiedAt: newestTimestamp(
      skill.installations.map((installation) => installation.modifiedAt),
    ),
    updateStatus: aggregateUpdateStatus(skill),
    installedAgents: [
      ...new Set(skill.installations.map((installation) => installation.agent)),
    ],
  };
}

export function buildSkillAssetSummary(
  snapshot: SkillSnapshot,
): SkillAssetSummary {
  return {
    skillCount: snapshot.skills.length,
    installationCount: snapshot.skills.reduce(
      (count, skill) => count + skill.installations.length,
      0,
    ),
    availableAgentCount: Object.values(snapshot.agents).filter(
      (agent) => agent.installed,
    ).length,
    detectedAgentCount: Object.values(snapshot.agents).filter(
      (agent) => agent.installed,
    ).length,
    lastScannedAt: snapshot.generatedAt,
  };
}

/**
 * Browser-safe asset projection used by the presentation layer. It accepts
 * only the public scanner DTO and never reintroduces filesystem data.
 */
export function querySkillAssets(
  snapshot: SkillSnapshot,
  filters: SkillAssetFilters,
): SkillAssetView[] {
  const normalizedText = filters.text.trim().toLocaleLowerCase();
  const assets = snapshot.skills.map(toSkillAssetView).filter((skill) => {
    const matchesText =
      normalizedText.length === 0 ||
      skill.name.toLocaleLowerCase().includes(normalizedText) ||
      skill.description?.toLocaleLowerCase().includes(normalizedText) === true;
    return (
      matchesText &&
      (filters.agent === "all" ||
        skill.installedAgents.includes(filters.agent)) &&
      (filters.source === "all" ||
        skill.sourceKinds.includes(filters.source)) &&
      (filters.updateStatus === "all" ||
        skill.updateStatus === filters.updateStatus)
    );
  });

  return assets.sort((left, right) => {
    let comparison: number;
    if (filters.sort === "name") {
      comparison = left.name.localeCompare(right.name);
    } else {
      const field =
        filters.sort === "lastUsedAt" ? "lastUsedAt" : "latestModifiedAt";
      const leftValue = dateValue(left[field]);
      const rightValue = dateValue(right[field]);
      comparison =
        (leftValue ?? Number.NEGATIVE_INFINITY) -
        (rightValue ?? Number.NEGATIVE_INFINITY);
    }
    if (comparison === 0) comparison = left.name.localeCompare(right.name);
    return filters.direction === "asc" ? comparison : -comparison;
  });
}

export function availableAssetSorts(snapshot: SkillSnapshot): AssetSortKey[] {
  const assets = snapshot.skills.map(toSkillAssetView);
  return [
    "name",
    ...(assets.some((skill) => dateValue(skill.lastUsedAt) != null)
      ? (["lastUsedAt"] as const)
      : []),
    ...(assets.some((skill) => dateValue(skill.latestModifiedAt) != null)
      ? (["modifiedAt"] as const)
      : []),
  ];
}
