import { createServerFn } from "@tanstack/react-start";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  SKILL_AGENTS,
  type BatchUninstallResult,
  type SkillAgent,
  type SkillSnapshot,
  type SkillSyncResult,
} from "./types.ts";
import type { HealthThresholds } from "./scanner.server.ts";

const stringInput = (value: unknown): string => {
  if (typeof value !== "string" || value.length === 0)
    throw new Error("参数不能为空");
  return value;
};

const batchPathsInput = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) {
    throw new Error("批量卸载路径数量不合法");
  }
  if (
    value.some((path) => typeof path !== "string" || path.trim().length === 0)
  ) {
    throw new Error("批量卸载路径不合法");
  }
  return [...new Set(value)];
};

async function readHealthThresholds(): Promise<HealthThresholds> {
  let prefsDir: string;
  try {
    const { app } = await import("electron");
    prefsDir = app.getPath("userData");
  } catch {
    prefsDir = join(homedir(), ".trusttools");
  }
  const prefsPath = join(prefsDir, "trusttools-prefs.json");
  try {
    const raw = await readFile(prefsPath, "utf8");
    const prefs = JSON.parse(raw) as Record<string, unknown>;
    return {
      lowFrequencyCount:
        typeof prefs.lowFrequencyCount === "number" &&
        Number.isFinite(prefs.lowFrequencyCount)
          ? (prefs.lowFrequencyCount as number)
          : 5,
      dozeDays:
        typeof prefs.dozeDays === "number" && Number.isFinite(prefs.dozeDays)
          ? (prefs.dozeDays as number)
          : 30,
      deadDays:
        typeof prefs.deadDays === "number" && Number.isFinite(prefs.deadDays)
          ? (prefs.deadDays as number)
          : 90,
    };
  } catch {
    return { lowFrequencyCount: 5, dozeDays: 30, deadDays: 90 };
  }
}

export const getLocalSkills = createServerFn({ method: "GET" }).handler(
  async (): Promise<SkillSnapshot> => {
    const [{ scanLocalSkills }, { getCachedLocalUsageSnapshot }, thresholds] =
      await Promise.all([
        import("./scanner.server.ts"),
        import("../local-usage/snapshot.server.ts"),
        readHealthThresholds(),
      ]);
    const usage = await getCachedLocalUsageSnapshot();
    return scanLocalSkills({
      usageEvents: usage.details,
      healthThresholds: thresholds,
    });
  },
);

export const refreshSkillMarketEvidence = createServerFn({
  method: "POST",
}).handler(async (): Promise<boolean> => {
  const { refreshMarketSkillEvidence } = await import("./scanner.server.ts");
  return refreshMarketSkillEvidence();
});

export const installSkill = createServerFn({ method: "POST" })
  .validator((input: { sourcePath: string; targetAgent: SkillAgent }) => {
    if (
      typeof input?.sourcePath !== "string" ||
      !SKILL_AGENTS.includes(input?.targetAgent)
    ) {
      throw new Error("安装参数不合法");
    }
    return input;
  })
  .handler(async ({ data }): Promise<void> => {
    const { installLocalSkill } = await import("./scanner.server.ts");
    await installLocalSkill(data);
  });

export const uninstallSkill = createServerFn({ method: "POST" })
  .validator(stringInput)
  .handler(async ({ data }): Promise<{ path: string }> => {
    const { uninstallLocalSkill } = await import("./scanner.server.ts");
    return uninstallLocalSkill(data);
  });

export const batchUninstallSkills = createServerFn({ method: "POST" })
  .validator(batchPathsInput)
  .handler(async ({ data }): Promise<BatchUninstallResult> => {
    const { batchUninstallLocalSkills } = await import("./scanner.server.ts");
    return batchUninstallLocalSkills(data);
  });

export const syncLocalSkill = createServerFn({ method: "POST" })
  .validator(
    (input: {
      sourcePath: string;
      targetAgents: string[];
      onConflict: "overwrite" | "skip";
    }) => {
      if (
        typeof input?.sourcePath !== "string" ||
        !Array.isArray(input?.targetAgents) ||
        input.targetAgents.length === 0 ||
        input.targetAgents.length > SKILL_AGENTS.length ||
        input.targetAgents.some(
          (agent) => typeof agent !== "string" || !SKILL_AGENTS.includes(agent),
        ) ||
        (input.onConflict !== "overwrite" && input.onConflict !== "skip")
      ) {
        throw new Error("同步参数不合法");
      }
      return input;
    },
  )
  .handler(async ({ data }): Promise<SkillSyncResult> => {
    const { syncLocalSkill: doSyncLocalSkill } =
      await import("./scanner.server.ts");
    return doSyncLocalSkill(data);
  });

export const updateSkillBlacklist = createServerFn({ method: "POST" })
  .validator((input: { name: string; blocked: boolean }) => {
    if (
      typeof input?.name !== "string" ||
      typeof input?.blocked !== "boolean"
    ) {
      throw new Error("黑名单参数不合法");
    }
    return input;
  })
  .handler(async ({ data }): Promise<void> => {
    const { setSkillBlacklisted } = await import("./scanner.server.ts");
    await setSkillBlacklisted(data.name, data.blocked);
  });
