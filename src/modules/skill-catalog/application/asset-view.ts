import type { SkillForm } from "../../../lib/local-skills/types.ts";
import type {
  LocalSkill,
  SkillAgent,
  SkillSnapshot,
} from "../query/contracts.ts";

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

/**
 * A renderer-safe description of where a Skill is currently available.  This
 * deliberately reports product-level state only: it contains no roots,
 * filesystem locations, repository names, or source URLs.
 */
export interface SkillAgentCoverage {
  readonly agent: SkillAgent;
  readonly installed: boolean;
  readonly skillCount: number;
  readonly state: "covered" | "available" | "unavailable";
}

export interface SkillWorkspaceFacet<T extends string> {
  readonly value: T;
  readonly count: number;
}

/** Compact, browser-safe counters used by the Skill operations workspace. */
export interface SkillWorkspaceSummary extends SkillAssetSummary {
  readonly activeAgentCount: number;
  readonly coveragePercent: number;
  readonly updateAvailableCount: number;
  readonly unassignedSkillCount: number;
}

export interface SkillWorkspaceFacets {
  readonly agents: readonly SkillWorkspaceFacet<SkillAgent>[];
  readonly sources: readonly SkillWorkspaceFacet<
    Exclude<AssetSourceFilter, "all">
  >[];
  readonly updates: readonly SkillWorkspaceFacet<
    Exclude<AssetUpdateFilter, "all">
  >[];
  readonly forms: readonly SkillWorkspaceFacet<SkillForm>[];
}

/**
 * The complete public data contract for the operations workspace.  Keep this
 * projection separate from scanner records so presentation cannot accidentally
 * grow a dependency on paths or raw source metadata.
 */
export interface SkillWorkspace {
  readonly summary: SkillWorkspaceSummary;
  readonly coverage: readonly SkillAgentCoverage[];
  readonly facets: SkillWorkspaceFacets;
  readonly items: readonly SkillAssetView[];
}

export interface SkillAssetFilters {
  readonly text: string;
  readonly agent: "all" | SkillAgent;
  readonly source: AssetSourceFilter;
  readonly form: "all" | SkillForm;
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

function countFacet<T extends string>(
  values: readonly T[],
): readonly SkillWorkspaceFacet<T>[] {
  return [...new Map(values.map((value) => [value, 0] as const))].map(
    ([value]) => ({
      value,
      count: values.filter((candidate) => candidate === value).length,
    }),
  );
}

/**
 * Builds every value rendered in the workspace from the public scan DTO.  Do
 * not add scanner roots, paths, or raw source labels to this return value.
 */
export function buildSkillWorkspace(snapshot: SkillSnapshot): SkillWorkspace {
  const items = snapshot.skills.map(toSkillAssetView);
  const coverage: SkillAgentCoverage[] = Object.entries(snapshot.agents).map(
    ([agent, probe]) => {
      const skillCount = items.filter((item) =>
        item.installedAgents.includes(agent as SkillAgent),
      ).length;
      return {
        agent: agent as SkillAgent,
        installed: probe.installed,
        skillCount,
        state: !probe.installed
          ? "unavailable"
          : skillCount > 0
            ? "covered"
            : "available",
      };
    },
  );
  const availableAgentCount = coverage.filter((item) => item.installed).length;
  const activeAgentCount = coverage.filter(
    (item) => item.installed && item.skillCount > 0,
  ).length;
  const base = buildSkillAssetSummary(snapshot);

  return {
    summary: {
      ...base,
      activeAgentCount,
      coveragePercent:
        availableAgentCount === 0
          ? 0
          : Math.round((activeAgentCount / availableAgentCount) * 100),
      updateAvailableCount: items.filter(
        (item) => item.updateStatus === "available",
      ).length,
      unassignedSkillCount: items.filter(
        (item) => item.installations.length === 0,
      ).length,
    },
    coverage,
    facets: {
      agents: coverage.map(({ agent, skillCount }) => ({
        value: agent,
        count: skillCount,
      })),
      sources: countFacet(items.flatMap((item) => item.sourceKinds)),
      updates: countFacet(items.map((item) => item.updateStatus)),
      forms: countFacet(items.map((item) => item.form ?? "package")),
    },
    items,
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
      (filters.form === "all" || (skill.form ?? "package") === filters.form) &&
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
