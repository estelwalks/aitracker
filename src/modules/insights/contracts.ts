export const insightsModuleId = "insights" as const;
export type InsightsModuleId = typeof insightsModuleId;
export interface InsightsModuleContract {
  readonly module: InsightsModuleId;
  readonly schemaVersion: 1;
}
