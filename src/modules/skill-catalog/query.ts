import { createServerFn } from "@tanstack/react-start";

import {
  buildSkillWorkspace,
  type SkillWorkspace,
} from "./application/asset-view.ts";

import type { SkillSnapshot as LegacySkillSnapshot } from "../../lib/local-skills/types.ts";
import type {
  BatchUninstallResult,
  LocalSkill,
  SkillAgent,
  SkillInstallation,
  SkillSnapshot,
  SkillSyncResult,
} from "./query/contracts.ts";

export type {
  BatchUninstallResult,
  LocalSkill,
  SkillAgent,
  SkillFileEntry,
  SkillFileList,
  SkillInstallation,
  SkillSnapshot,
  SkillSyncResult,
} from "./query/contracts.ts";
/** Server query result consumed by the Skill operations workspace route. */
export interface SkillWorkspaceSnapshot {
  readonly snapshot: SkillSnapshot;
  readonly workspace: SkillWorkspace;
}
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
      sizeBytes: skill.sizeBytes,
      tokenEstimate: skill.tokenEstimate,
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

/**
 * A single public query boundary for the workspace shell. Both the raw
 * snapshot and the UI projection have already been stripped of filesystem and
 * source-location data before they cross the server boundary.
 */
export const getSkillWorkspace = createServerFn({ method: "GET" }).handler(
  async (): Promise<SkillWorkspaceSnapshot> => {
    const snapshot = projectSnapshot(await legacySnapshot());
    return { snapshot, workspace: buildSkillWorkspace(snapshot) };
  },
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
export { getSkillFiles } from "../../lib/local-skills/server-fns.ts";
export type { SkillAgent as LocalSkillAgent } from "../../lib/local-skills/types.ts";
