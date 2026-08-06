export const dashboardModuleId = "dashboard" as const;
export type DashboardModuleId = typeof dashboardModuleId;
export interface DashboardModuleContract {
  readonly module: DashboardModuleId;
  readonly schemaVersion: 1;
}
