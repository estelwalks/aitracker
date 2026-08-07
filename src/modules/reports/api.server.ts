/** Server-only transport adapter; report bodies stay behind this boundary. */
export { createReportsApplication } from "./application/index.ts";
export {
  createReportsPresentation,
  createTaskBackedReportsSource,
} from "./presentation/index.ts";
export type { ReportsApplicationOptions } from "./application/index.ts";
export type { ReportsApplication, ReportSummary } from "./contracts.ts";
export type {
  MemoryAssetSummary,
  ReportDetailSummary,
  ReportListItem,
  ReportQueryViewModel,
  ReportsFeed,
  ReportsPresentationApi,
  ReportsPresentationOptions,
  ReportsQuerySource,
  ReportUiStatus,
} from "./presentation/index.ts";
