import { createServerFn } from "@tanstack/react-start";

import type {
  CleanupStats,
  CollectedDataCleanupStats,
  StorageUsage,
} from "./data-lifecycle.server";

/**
 * Browser-safe settings data-lifecycle facade.
 *
 * The route talks to these RPCs instead of importing the data-lifecycle
 * infrastructure directly. The implementation remains server-owned and is
 * loaded lazily so Node filesystem/SQLite APIs never become part of the
 * renderer bundle.
 */
export const getStorageUsageQuery = createServerFn({ method: "GET" }).handler(
  async (): Promise<StorageUsage> => {
    const { readStorageUsage } = await import("./data-lifecycle.server");
    return readStorageUsage();
  },
);

export const applyRetentionPolicyQuery = createServerFn({ method: "POST" })
  .validator((value: unknown): { retentionDays: number } => {
    if (
      typeof value !== "object" ||
      value === null ||
      !Number.isInteger((value as { retentionDays?: unknown }).retentionDays)
    ) {
      throw new Error("retentionDays must be an integer");
    }
    return value as { retentionDays: number };
  })
  .handler(
    async ({
      data,
    }): Promise<{ cleanup: CleanupStats; usage: StorageUsage }> => {
      const { applyRetentionPolicy } = await import("./data-lifecycle.server");
      return applyRetentionPolicy(data.retentionDays);
    },
  );

export const clearRegenerableCacheQuery = createServerFn({
  method: "POST",
}).handler(
  async (): Promise<{ cleanup: CleanupStats; usage: StorageUsage }> => {
    const { clearRegenerableCache } = await import("./data-lifecycle.server");
    return clearRegenerableCache();
  },
);

/**
 * Destructive local-collection reset. The explicit confirmation is validated
 * on the server as well as in the UI dialog so a stale/forged renderer call
 * cannot clear collection results accidentally.
 */
export const clearCollectedDataQuery = createServerFn({ method: "POST" })
  .validator((value: unknown): { confirmed: true } => {
    if (
      typeof value !== "object" ||
      value === null ||
      (value as { confirmed?: unknown }).confirmed !== true
    ) {
      throw new Error("clearCollectedData requires explicit confirmation");
    }
    return { confirmed: true };
  })
  .handler(
    async ({
      data: _data,
    }): Promise<{
      cleanup: CollectedDataCleanupStats;
      usage: StorageUsage;
    }> => {
      const { clearCollectedData } = await import("./data-lifecycle.server");
      return clearCollectedData();
    },
  );

export type { CleanupStats, CollectedDataCleanupStats, StorageUsage };
