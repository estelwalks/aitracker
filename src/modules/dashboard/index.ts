export { dashboardModuleId } from "./contracts";
export type {
  DashboardModuleContract,
  DashboardModuleId,
  DashboardQuery,
  DashboardReadModel,
  DashboardSelection,
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
