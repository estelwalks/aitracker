import { createServerFn } from "@tanstack/react-start";

import type {
  CleanupStats,
  StorageUsage,
} from "../../lib/local-usage/prune.server";

/**
 * Browser-safe settings data-lifecycle facade.
 *
 * The route talks to these RPCs instead of importing the local-usage
 * infrastructure directly. The implementation remains server-owned and is
 * loaded lazily so Node filesystem APIs never become part of the renderer
 * bundle.
 */
export const getStorageUsageQuery = createServerFn({ method: "GET" }).handler(
  async (): Promise<StorageUsage> => {
    const { getStorageUsageFn } = await import(
      "../../lib/local-usage/prune.server"
    );
    return getStorageUsageFn();
  },
);

export const applyRetentionPolicyQuery = createServerFn({ method: "POST" })
  .inputValidator((value: unknown): { retentionDays: number } => {
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
    async ({ data }): Promise<{ cleanup: CleanupStats; usage: StorageUsage }> => {
      const { applyRetentionPolicyFn } = await import(
        "../../lib/local-usage/prune.server"
      );
      return applyRetentionPolicyFn({ data });
    },
  );

export const clearRegenerableCacheQuery = createServerFn({
  method: "POST",
}).handler(
  async (): Promise<{ cleanup: CleanupStats; usage: StorageUsage }> => {
    const { clearRegenerableCacheFn } = await import(
      "../../lib/local-usage/prune.server"
    );
    return clearRegenerableCacheFn();
  },
);

export type { CleanupStats, StorageUsage };
