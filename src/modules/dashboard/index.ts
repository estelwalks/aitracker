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
export type {
  DashboardCustomWindowResult,
  DashboardSummaryQueryInput,
  DashboardSummaryReadModel,
  DashboardWindowSummary,
} from "./summary-contracts";
export { windowToView } from "./summary-contracts";
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
export {
  getDashboardCustomWindow,
  getDashboardSummaryReadModel,
} from "./summary-query";
