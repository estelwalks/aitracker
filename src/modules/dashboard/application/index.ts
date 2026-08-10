import type {
  DashboardModuleContract,
  DashboardQuery,
  DashboardReadModel,
} from "../contracts";
export interface DashboardApplication {
  readonly contract: DashboardModuleContract;
  readonly read: (query: DashboardQuery) => DashboardReadModel;
}

export { createDashboardV2HeroView, createDashboardV2View } from "./v2.ts";

/** Pure composition facade; adapters provide the query data. */
export function createDashboardApplication(): DashboardApplication {
  return {
    contract: { module: "dashboard", schemaVersion: 1 },
    read: (query) => query,
  };
}
