import { createServerFn } from "@tanstack/react-start";

import {
  SKILL_AGENTS,
  type BatchTrashResult,
  type SkillAgent,
  type SkillSnapshot,
  type TrashEntry,
} from "./types.ts";

const stringInput = (value: unknown): string => {
  if (typeof value !== "string" || value.length === 0) throw new Error("参数不能为空");
  return value;
};

const batchPathsInput = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) {
    throw new Error("批量卸载路径数量不合法");
  }
  if (value.some((path) => typeof path !== "string" || path.trim().length === 0)) {
    throw new Error("批量卸载路径不合法");
  }
  return [...new Set(value)];
};

export const getLocalSkills = createServerFn({ method: "GET" }).handler(
  async (): Promise<SkillSnapshot> => {
    const [{ scanLocalSkills }, { getCachedLocalUsageSnapshot }] = await Promise.all([
      import("./scanner.server.ts"),
      import("../local-usage/snapshot.server.ts"),
    ]);
    const usage = await getCachedLocalUsageSnapshot();
    return scanLocalSkills({ usageEvents: usage.details });
  },
);

export const refreshSkillMarketEvidence = createServerFn({ method: "POST" }).handler(
  async (): Promise<boolean> => {
    const { refreshMarketSkillEvidence } = await import("./scanner.server.ts");
    return refreshMarketSkillEvidence();
  },
);

export const installSkill = createServerFn({ method: "POST" })
  .validator((input: { sourcePath: string; targetAgent: SkillAgent }) => {
    if (typeof input?.sourcePath !== "string" || !SKILL_AGENTS.includes(input?.targetAgent)) {
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
  .handler(async ({ data }): Promise<TrashEntry> => {
    const { trashLocalSkill } = await import("./scanner.server.ts");
    return trashLocalSkill(data);
  });

export const batchUninstallSkills = createServerFn({ method: "POST" })
  .validator(batchPathsInput)
  .handler(async ({ data }): Promise<BatchTrashResult> => {
    const { trashLocalSkills } = await import("./scanner.server.ts");
    return trashLocalSkills(data);
  });

export const restoreSkill = createServerFn({ method: "POST" })
  .validator(stringInput)
  .handler(async ({ data }): Promise<void> => {
    const { restoreLocalSkill } = await import("./scanner.server.ts");
    await restoreLocalSkill(data);
  });

export const updateSkillBlacklist = createServerFn({ method: "POST" })
  .validator((input: { name: string; blocked: boolean }) => {
    if (typeof input?.name !== "string" || typeof input?.blocked !== "boolean") {
      throw new Error("黑名单参数不合法");
    }
    return input;
  })
  .handler(async ({ data }): Promise<void> => {
    const { setSkillBlacklisted } = await import("./scanner.server.ts");
    await setSkillBlacklisted(data.name, data.blocked);
  });
