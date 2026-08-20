import { createServerFn } from "@tanstack/react-start";

import type { CleanupStats, StorageUsage } from "./data-lifecycle.server";

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
    const { getStorageUsageFn } = await import("./data-lifecycle.server");
    return getStorageUsageFn();
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
      const { applyRetentionPolicyFn } =
        await import("./data-lifecycle.server");
      return applyRetentionPolicyFn({ data });
    },
  );

export const clearRegenerableCacheQuery = createServerFn({
  method: "POST",
}).handler(
  async (): Promise<{ cleanup: CleanupStats; usage: StorageUsage }> => {
    const { clearRegenerableCacheFn } = await import("./data-lifecycle.server");
    return clearRegenerableCacheFn();
  },
);

export type { CleanupStats, StorageUsage };
