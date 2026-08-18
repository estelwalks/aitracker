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
export { DashboardPage } from "./presentation/DashboardPage";
export {
  getDashboardCustomWindow,
  getDashboardSummaryReadModel,
} from "./summary-query";
