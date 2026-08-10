import { z } from "zod";

import type { AtomicJsonStore } from "../../platform/persistence/contracts.ts";
import {
  monitoringModuleId,
  type MonitoringStatus,
  type MonitoringStatusStore,
} from "./contracts.ts";

const collectorSchema = z
  .object({
    id: z.enum(["usage", "skills", "sessions", "security"]),
    state: z.enum(["idle", "running", "healthy", "degraded", "failed"]),
    pending: z.boolean(),
    lastStartedAt: z.string().datetime({ offset: true }).optional(),
    lastSucceededAt: z.string().datetime({ offset: true }).optional(),
    lastFailedAt: z.string().datetime({ offset: true }).optional(),
    errorCode: z
      .string()
      .regex(/^errors\./)
      .optional(),
  })
  .strict();

export const monitoringStatusSchema = {
  currentVersion: 1,
  parse(value: unknown): MonitoringStatus {
    const parsed = z
      .object({
        module: z.literal(monitoringModuleId),
        running: z.boolean(),
        startedAt: z.string().datetime({ offset: true }).optional(),
        heartbeatAt: z.string().datetime({ offset: true }).optional(),
        pendingCount: z.number().int().nonnegative(),
        collectors: z.array(collectorSchema),
        security: z
          .object({
            assessedAt: z.string().datetime({ offset: true }),
            discoveredAssetCount: z.number().int().nonnegative(),
            assessedAssetCount: z.number().int().nonnegative(),
            failedAssetCount: z.number().int().nonnegative(),
            cleanCount: z.number().int().nonnegative(),
            suspiciousCount: z.number().int().nonnegative(),
            dangerousCount: z.number().int().nonnegative(),
            unknownCount: z.number().int().nonnegative(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .parse(value);
    return parsed as MonitoringStatus;
  },
};

export function createAtomicMonitoringStatusStore(
  store: AtomicJsonStore<MonitoringStatus | null>,
): MonitoringStatusStore {
  return {
    async load() {
      return (await store.read()).value ?? undefined;
    },
    async save(status) {
      await store.write(status);
    },
  };
}
