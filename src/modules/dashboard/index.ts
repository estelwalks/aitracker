export { dashboardModuleId } from "./contracts";
export type {
  DashboardModuleContract,
  DashboardModuleId,
  DashboardQuery,
  DashboardReadModel,
  DashboardSelection,
  DashboardV2Event,
  DashboardV2Snapshot,
  DashboardV2Tool,
} from "./contracts";
export {
  createDashboardApplication,
  createDashboardV2View,
} from "./application";
export {
  buildDashboardPosterData,
  buildDashboardExport,
  type DashboardPosterData,
  type DashboardViewModel,
} from "./presentation";
export { DashboardPage } from "./presentation/DashboardPage";
export { getDashboardReadModel } from "./query";
