import { createServerFn } from "@tanstack/react-start";

import {
  buildSkillWorkspace,
  type SkillWorkspace,
} from "./application/asset-view.ts";

import type { SkillSnapshotData } from "./query/contracts.ts";
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
export type { SkillSnapshotData } from "./query/contracts.ts";
/** Server query result consumed by the Skill operations workspace route. */
export interface SkillWorkspaceSnapshot {
  readonly snapshot: SkillSnapshot;
  readonly workspace: SkillWorkspace;
}
export { SKILL_AGENTS } from "../../lib/local-skills/types.ts";

const refFor = (skillId: string, agent: string, index: number) =>
  `installation:${encodeURIComponent(skillId)}:${encodeURIComponent(agent)}:${index}`;

function projectSnapshot(value: SkillSnapshotData): SkillSnapshot {
  return {
    generatedAt: value.generatedAt,
    fingerprint: value.fingerprint,
    roots: Object.fromEntries(
      Object.entries(value.roots).map(([agent, roots]) => [
        agent,
        { count: roots.count },
      ]),
    ) as SkillSnapshot["roots"],
    agents: Object.fromEntries(
      Object.entries(value.agents).map(([agent, probe]) => [
        agent,
        { installed: probe.installed },
      ]),
    ) as SkillSnapshot["agents"],
    blacklist: [...value.blacklist],
    skills: value.skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      form: skill.form ?? null,
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

const EMPTY_SKILL_SNAPSHOT: SkillSnapshotData = {
  generatedAt: new Date(0).toISOString(),
  fingerprint: "",
  roots: {},
  agents: {},
  skills: [],
  blacklist: [],
};

/**
 * T7-08: page read path — the O(1) skill snapshot, never a scan. An empty
 * snapshot triggers one NON-BLOCKING background refresh, then degrades to an
 * empty view so the loader never waits for a scan (design §4.3 / G4).
 */
async function readSkillSnapshot(): Promise<SkillSnapshotData> {
  const { getCompositionRoot } =
    await import("../../app/composition.server.ts");
  const { skillSnapshot } = await getCompositionRoot();
  await skillSnapshot.ensureHydrated();
  let latest = skillSnapshot.readLatest();
  if (latest.data == null) {
    // T3-11: empty-state refresh through the unified task runtime.
    void skillSnapshot.requestRefresh({ reason: "empty" }).catch(() => {});
    latest = skillSnapshot.readLatest();
  }
  return latest.data ?? EMPTY_SKILL_SNAPSHOT;
}

/**
 * Operation path (uninstall/install/sync): these server-side actions resolve
 * an opaque installation ref to its real path, so they scan on demand without
 * any read-path cache (T7-08). Low frequency, never part of page rendering.
 */
async function scanSkillSnapshot(): Promise<LegacySkillSnapshot> {
  const { scanLocalSkills } =
    await import("../../lib/local-skills/scanner.server.ts");
  return scanLocalSkills();
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
  async (): Promise<SkillSnapshot> =>
    projectSnapshot(await readSkillSnapshot()),
);

/**
 * Forces a fresh on-disk scan and commits it to the cached snapshot. Used
 * after install/uninstall so the UI reflects the new state immediately
 * instead of re-reading the pre-operation cache.
 */
export const refreshSkillSnapshot = createServerFn({ method: "POST" }).handler(
  async (): Promise<SkillSnapshot> => {
    const { getCompositionRoot } =
      await import("../../app/composition.server.ts");
    const { skillSnapshot } = await getCompositionRoot();
    await skillSnapshot.refreshNow();
    return projectSnapshot(await readSkillSnapshot());
  },
);

/**
 * A single public query boundary for the workspace shell. Both the raw
 * snapshot and the UI projection have already been stripped of filesystem and
 * source-location data before they cross the server boundary.
 */
export const getSkillWorkspace = createServerFn({ method: "GET" }).handler(
  async (): Promise<SkillWorkspaceSnapshot> => {
    const snapshot = projectSnapshot(await readSkillSnapshot());
    return { snapshot, workspace: buildSkillWorkspace(snapshot) };
  },
);

export const requestApprovedSkillUninstall = createServerFn({ method: "POST" })
  .validator((input: { confirmed: boolean; installationRef: string }) => input)
  .handler(async ({ data }) => {
    if (data.confirmed !== true)
      throw new Error("errors.skillDistribution.notApproved");
    const snapshot = await scanSkillSnapshot();
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
    const snapshot = await scanSkillSnapshot();
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
    const snapshot = await scanSkillSnapshot();
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
    const snapshot = await scanSkillSnapshot();
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
export type {
  SkillAgent as LocalSkillAgent,
  SkillForm,
} from "../../lib/local-skills/types.ts";
