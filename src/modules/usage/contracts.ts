/** Browser-safe contracts owned by the usage feature. */
export const usageModuleId = "usage" as const;
export type UsageModuleId = typeof usageModuleId;
export interface UsageModuleContract {
  readonly module: UsageModuleId;
  readonly schemaVersion: 1;
}
