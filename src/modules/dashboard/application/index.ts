import type {
  DashboardModuleContract,
  DashboardQuery,
  DashboardReadModel,
} from "../contracts";
export interface DashboardApplication {
  readonly contract: DashboardModuleContract;
  readonly read: (query: DashboardQuery) => DashboardReadModel;
}

/** Pure composition facade; adapters provide the query data. */
export function createDashboardApplication(): DashboardApplication {
  return {
    contract: { module: "dashboard", schemaVersion: 1 },
    read: (query) => query,
  };
}
