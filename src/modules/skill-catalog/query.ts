import { createServerFn } from "@tanstack/react-start";

import type {
  BatchUninstallResult as LegacyBatchUninstallResult,
  LocalSkill as LegacyLocalSkill,
  SkillAgent as LegacySkillAgent,
  SkillSnapshot as LegacySkillSnapshot,
  SkillSyncResult as LegacySkillSyncResult,
} from "../../lib/local-skills/types.ts";

export type SkillInstallation = Omit<
  LegacyLocalSkill["installations"][number],
  "path" | "source"
> & {
  readonly installationRef: string;
  readonly source: {
    readonly kind: "frontmatter" | "market";
    readonly label: string;
  } | null;
};
export type LocalSkill = Omit<LegacyLocalSkill, "installations"> & {
  readonly installations: readonly SkillInstallation[];
};
export type SkillSnapshot = Omit<
  LegacySkillSnapshot,
  "roots" | "agents" | "skills"
> & {
  readonly roots: Record<SkillAgent, { readonly count: number }>;
  readonly agents: Record<SkillAgent, { installed: boolean }>;
  readonly skills: readonly LocalSkill[];
};
export type SkillAgent = LegacySkillAgent;
export type BatchUninstallResult = Omit<
  LegacyBatchUninstallResult,
  "succeeded" | "failed"
> & {
  readonly succeeded: readonly string[];
  readonly failed: readonly (Omit<
    LegacyBatchUninstallResult["failed"][number],
    "path"
  > & {
    readonly installationRef: string;
  })[];
};
export type SkillSyncResult = Omit<
  LegacySkillSyncResult,
  "succeeded" | "failed"
> & {
  readonly succeeded: readonly { agent: string; installationRef: string }[];
  readonly failed: readonly (Omit<
    LegacySkillSyncResult["failed"][number],
    "agent"
  > & {
    readonly agent: string;
  })[];
};

export { SKILL_AGENTS } from "../../lib/local-skills/types.ts";

const refFor = (skillId: string, agent: string, index: number) =>
  `installation:${encodeURIComponent(skillId)}:${encodeURIComponent(agent)}:${index}`;

function projectSnapshot(value: LegacySkillSnapshot): SkillSnapshot {
  return {
    generatedAt: value.generatedAt,
    fingerprint: value.fingerprint,
    roots: Object.fromEntries(
      Object.entries(value.roots).map(([agent, roots]) => [
        agent,
        { count: roots.length },
      ]),
    ) as SkillSnapshot["roots"],
    agents: Object.fromEntries(
      Object.entries(value.agents).map(([agent, probe]) => [
        agent,
        { installed: probe.installed },
      ]),
    ) as SkillSnapshot["agents"],
    blacklist: value.blacklist,
    skills: value.skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      lastUsedAt: skill.lastUsedAt,
      installations: skill.installations.map((installation, index) => ({
        installationRef: refFor(skill.id, installation.agent, index),
        agent: installation.agent,
        installedAt: installation.installedAt,
        modifiedAt: installation.modifiedAt,
        version: installation.version,
        source: installation.source
          ? { kind: installation.source.kind, label: installation.source.label }
          : null,
        updateStatus: installation.updateStatus,
        updateReason: installation.updateReason,
      })),
    })),
  };
}

async function legacySnapshot() {
  const { getLocalSkills } =
    await import("../../lib/local-skills/server-fns.ts");
  return getLocalSkills();
}

function resolveInstallation(value: LegacySkillSnapshot, ref: string) {
  const match = /^installation:([^:]+):([^:]+):(\d+)$/.exec(ref);
  if (!match) throw new Error("errors.skills.emptyInput");
  const skillId = decodeURIComponent(match[1]);
  const agent = decodeURIComponent(match[2]);
  const index = Number(match[3]);
  const skill = value.skills.find((item) => item.id === skillId);
  const installation = skill?.installations[index];
  if (!skill || !installation || installation.agent !== agent)
    throw new Error("errors.skills.emptyInput");
  return { skill, installation };
}

export const getLocalSkills = createServerFn({ method: "GET" }).handler(
  async (): Promise<SkillSnapshot> => projectSnapshot(await legacySnapshot()),
);

export const requestApprovedSkillUninstall = createServerFn({ method: "POST" })
  .validator((input: { confirmed: boolean; installationRef: string }) => input)
  .handler(async ({ data }) => {
    if (data.confirmed !== true)
      throw new Error("errors.skillDistribution.notApproved");
    const snapshot = await legacySnapshot();
    const { installation } = resolveInstallation(
      snapshot,
      data.installationRef,
    );
    const { uninstallSkill } =
      await import("../../lib/local-skills/server-fns.ts");
    return uninstallSkill({ data: installation.path });
  });

export const requestApprovedSkillInstall = createServerFn({ method: "POST" })
  .validator(
    (input: {
      confirmed: boolean;
      installationRef: string;
      targetAgent: SkillAgent;
    }) => input,
  )
  .handler(async ({ data }) => {
    if (data.confirmed !== true)
      throw new Error("errors.skillDistribution.notApproved");
    const snapshot = await legacySnapshot();
    const { installation } = resolveInstallation(
      snapshot,
      data.installationRef,
    );
    const { installSkill } =
      await import("../../lib/local-skills/server-fns.ts");
    return installSkill({
      data: { sourcePath: installation.path, targetAgent: data.targetAgent },
    });
  });

export const requestApprovedBatchUninstall = createServerFn({ method: "POST" })
  .validator(
    (input: { confirmed: boolean; installationRefs: string[] }) => input,
  )
  .handler(async ({ data }): Promise<BatchUninstallResult> => {
    if (data.confirmed !== true)
      throw new Error("errors.skillDistribution.notApproved");
    const snapshot = await legacySnapshot();
    const resolved = data.installationRefs.map((ref) =>
      resolveInstallation(snapshot, ref),
    );
    const { batchUninstallSkills } =
      await import("../../lib/local-skills/server-fns.ts");
    const result = await batchUninstallSkills({
      data: resolved.map(({ installation }) => installation.path),
    });
    const refByPath = new Map(
      resolved.map(({ installation }, index) => [
        installation.path,
        data.installationRefs[index] ?? "installation:unknown",
      ]),
    );
    return {
      succeeded: result.succeeded.map(
        (path) => refByPath.get(path) ?? "installation:unknown",
      ),
      failed: result.failed.map((failure, index) => ({
        installationRef:
          refByPath.get(failure.path) ??
          data.installationRefs[index] ??
          "installation:unknown",
        errorCode: failure.errorCode,
        ...(failure.errorParams ? { errorParams: failure.errorParams } : {}),
      })),
    };
  });

export const requestApprovedSkillSync = createServerFn({ method: "POST" })
  .validator(
    (input: {
      confirmed: boolean;
      installationRef: string;
      targetAgents: string[];
      onConflict: "overwrite" | "skip";
    }) => input,
  )
  .handler(async ({ data }): Promise<SkillSyncResult> => {
    if (data.confirmed !== true)
      throw new Error("errors.skillDistribution.notApproved");
    const snapshot = await legacySnapshot();
    const { installation } = resolveInstallation(
      snapshot,
      data.installationRef,
    );
    const { syncLocalSkill } =
      await import("../../lib/local-skills/server-fns.ts");
    const result = await syncLocalSkill({
      data: {
        sourcePath: installation.path,
        targetAgents: data.targetAgents,
        onConflict: data.onConflict,
      },
    });
    return {
      succeeded: result.succeeded.map((item) => ({
        agent: item.agent,
        installationRef: data.installationRef,
      })),
      skipped: result.skipped,
      failed: result.failed,
    };
  });

export { updateSkillBlacklist } from "../../lib/local-skills/server-fns.ts";
export type { SkillAgent as LocalSkillAgent } from "../../lib/local-skills/types.ts";
