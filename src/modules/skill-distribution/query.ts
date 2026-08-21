import { createServerFn } from "@tanstack/react-start";

import type {
  MarketAgent,
  MarketListResult as LegacyMarketListResult,
  MarketSkill as LegacyMarketSkill,
  MarketSort,
  InstallSkillResult as LegacyInstallSkillResult,
} from "../../lib/local-market/types.ts";

export type MarketSkill = Omit<LegacyMarketSkill, "repoPath"> & {
  /** Opaque market package identity; repository paths never reach the renderer. */
  readonly packageRef: string;
};
export type MarketListResult = Omit<LegacyMarketListResult, "skills"> & {
  readonly skills: readonly MarketSkill[];
};
export type { MarketAgent, MarketSort };
export type InstallSkillResult = Omit<
  LegacyInstallSkillResult,
  "inspection"
> & {
  readonly inspection: Omit<
    LegacyInstallSkillResult["inspection"],
    "skill" | "scan"
  > & {
    readonly skill: Omit<
      LegacyInstallSkillResult["inspection"]["skill"],
      "repoPath"
    >;
    readonly scan: Omit<
      LegacyInstallSkillResult["inspection"]["scan"],
      "findings"
    > & {
      readonly findings: readonly (Omit<
        LegacyInstallSkillResult["inspection"]["scan"]["findings"][number],
        "path"
      > & {
        readonly ref: string;
      })[];
    };
  };
};
export { MARKET_AGENTS } from "../../lib/local-market/index.ts";

const packageRefFor = (skill: LegacyMarketSkill) =>
  `package:${skill.id}:${encodeURIComponent(skill.slug)}`;

function projectSkill(skill: LegacyMarketSkill): MarketSkill {
  const { repoPath: _repoPath, ...safe } = skill;
  return { ...safe, packageRef: packageRefFor(skill) };
}

function projectResult(value: LegacyMarketListResult): MarketListResult {
  return { ...value, skills: value.skills.map(projectSkill) };
}

export const getMarketSkills = createServerFn({ method: "GET" })
  .validator(
    (input: {
      page: number;
      limit: number;
      search: string;
      sort: MarketSort;
      tags?: string[];
      forceRefresh?: boolean;
    }) => {
      if (
        input.forceRefresh !== undefined &&
        typeof input.forceRefresh !== "boolean"
      ) {
        throw new Error("errors.market.queryInvalid");
      }
      return input;
    },
  )
  .handler(async ({ data }) => {
    const { getMarketSkills: query } =
      await import("../../lib/local-market/index.ts");
    return projectResult(await query({ data }));
  });

function resolvePackageRef(value: string) {
  const match = /^package:(\d+):(.+)$/.exec(value);
  if (!match) throw new Error("errors.market.fieldInvalid");
  return { id: Number(match[1]), slug: decodeURIComponent(match[2]) };
}

function projectInstallResult(
  value: LegacyInstallSkillResult,
): InstallSkillResult {
  const { repoPath: _repoPath, ...skill } = value.inspection.skill;
  return {
    ...value,
    inspection: {
      ...value.inspection,
      skill,
      scan: {
        ...value.inspection.scan,
        findings: value.inspection.scan.findings.map((finding, index) => {
          const { path: _path, ...safe } = finding;
          return { ...safe, ref: `finding:${index}` };
        }),
      },
    },
  };
}

export const requestApprovedSkillInstall = createServerFn({ method: "POST" })
  .validator(
    (input: { confirmed: boolean; packageRef: string; agent: MarketAgent }) =>
      input,
  )
  .handler(async ({ data }) => {
    if (data.confirmed !== true)
      throw new Error("errors.skillDistribution.notApproved");
    const identity = resolvePackageRef(data.packageRef);
    const { getMarketSkills: query, requestSkillInstall } =
      await import("../../lib/local-market/index.ts");
    const result = await query({
      data: { page: 1, limit: 50, search: identity.slug, sort: "stars" },
    });
    const skill = result.skills.find(
      (item) => item.id === identity.id && item.slug === identity.slug,
    );
    if (!skill) throw new Error("errors.market.invalidSkill");
    const installed = await requestSkillInstall({
      data: {
        skill: {
          name: skill.name,
          repoOwner: skill.repoOwner,
          repoName: skill.repoName,
          repoPath: skill.repoPath,
          slug: skill.slug,
        },
        agents: [data.agent],
      },
    });
    return projectInstallResult(installed);
  });

export const requestMarketSkillUninstall = createServerFn({ method: "POST" })
  .validator(
    (input: { confirmed: boolean; packageRef: string; agent: MarketAgent }) =>
      input,
  )
  .handler(async ({ data }) => {
    if (data.confirmed !== true)
      throw new Error("errors.skillDistribution.notApproved");
    const identity = resolvePackageRef(data.packageRef);
    const { scanLocalSkills } =
      await import("../../lib/local-skills/scanner.server.ts");
    const snapshot = await scanLocalSkills();
    const paths = snapshot.skills
      .flatMap((item) => item.installations)
      .filter(
        (installation) =>
          installation.agent === data.agent &&
          installation.source?.kind === "market" &&
          installation.source.slug === identity.slug,
      )
      .map((installation) => installation.path);
    if (paths.length === 0) return { uninstalled: false, paths: 0 };
    const { batchUninstallSkills } =
      await import("../../lib/local-skills/server-fns.ts");
    const done = await batchUninstallSkills({ data: paths });
    return {
      uninstalled: done.succeeded.length > 0,
      paths: done.succeeded.length,
    };
  });

export type { SkillSnapshot } from "../skill-catalog/index.ts";
export {
  getLocalSkills,
  refreshSkillSnapshot,
} from "../skill-catalog/index.ts";
