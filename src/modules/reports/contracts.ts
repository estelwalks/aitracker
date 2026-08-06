export const reportsModuleId = "reports" as const;
export type ReportsModuleId = typeof reportsModuleId;
export interface ReportsModuleContract {
  readonly module: ReportsModuleId;
  readonly schemaVersion: 1;
}
