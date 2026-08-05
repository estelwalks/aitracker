import { createServerFn } from "@tanstack/react-start";

import {
  SKILL_AGENTS,
  type BatchUninstallResult,
  type SkillAgent,
  type SkillSnapshot,
  type SkillSyncResult,
} from "./types.ts";
import { AppError } from "../errors";

const stringInput = (value: unknown): string => {
  if (typeof value !== "string" || value.length === 0)
    throw new AppError("errors.skills.emptyInput");
  return value;
};

const batchPathsInput = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) {
    throw new AppError("errors.skills.batchPathsCount");
  }
  if (
    value.some((path) => typeof path !== "string" || path.trim().length === 0)
  ) {
    throw new AppError("errors.skills.batchPathsInvalid");
  }
  return [...new Set(value)];
};

export const getLocalSkills = createServerFn({ method: "GET" }).handler(
  async (): Promise<SkillSnapshot> => {
    const [{ scanLocalSkills }, { getCachedLocalUsageSnapshot }] =
      await Promise.all([
        import("./scanner.server.ts"),
        import("../local-usage/snapshot.server.ts"),
      ]);
    const usage = await getCachedLocalUsageSnapshot();
    return scanLocalSkills({ usageEvents: usage.details });
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
      throw new AppError("errors.skills.installInvalid");
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
        throw new AppError("errors.skills.syncInvalid");
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
      throw new AppError("errors.skills.blacklistInvalid");
    }
    return input;
  })
  .handler(async ({ data }): Promise<void> => {
    const { setSkillBlacklisted } = await import("./scanner.server.ts");
    await setSkillBlacklisted(data.name, data.blocked);
  });
