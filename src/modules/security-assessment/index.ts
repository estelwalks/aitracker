export { securityAssessmentModuleId } from "./contracts";
export type {
  AssetAssessment,
  AssetFinding,
  AssetHashRef,
  AssessmentFindingCounts,
  AssessmentHistorySummary,
  BackgroundSkillSecurityScanPort,
  BackgroundSkillSecurityScanResult,
  AssetKind,
  AssetRef,
  AssetVerdict,
  AssessmentRef,
  EvidenceRef,
  FindingRef,
  FindingSeverity,
  PublishGate,
  PublishGateDecision,
  PublishGateReason,
  RuleVersion,
  ScanJobRef,
  ScanJobRequest,
  ScanJobResult,
  ScanJobStatus,
  ScanRequest,
  SelectionRef,
  SecurityAssessmentInput,
  SecurityAssessmentHistoryStore,
  SecurityAssessmentModuleContract,
  SecurityAssessmentModuleId,
} from "./contracts";
export {
  canPublish,
  createAssetAssessment,
  evaluatePublishGate,
} from "./application/index";
export { assessmentFromSecurityReport } from "./adapters/scanner";
export { gateForDistillationCandidate } from "./adapters/distillation";
export {
  assessmentHistorySummary,
  parseScanRequest,
} from "./application/index";
export type { SecurityAssessmentViewModel } from "./presentation";
export {
  useSecurityScanOverview,
  type SecurityScanOverview,
} from "./query/use-security-scan-overview";

// Browser-safe security UI contracts and clients (P0 cleanup: consumers must
// import through this module entry instead of deep-importing presentation or
// query files).
export {
  SECURITY_RISK_KINDS,
  EMPTY_SECURITY_PROGRESS,
  EMPTY_SECURITY_TOTALS,
  dedupeHistoryByContentHash,
  summarizeReports,
  securityHistoryEntryIsSafe,
  skippedReasonCode,
  latestHistory,
  latestScanEntries,
  reportNeedsLocaleRefresh,
  isScanActive,
  clampPercent,
  countScanTasks,
  unsafeEntries,
  unsafeVerdictTone,
  hitDimensionsOf,
  severityCounts,
  aggregateScanTask,
  aggregateScanTasks,
  relativeTimeParts,
  type RelativeTimeUnit,
  type SecurityRiskKind,
  type SecurityScanMode,
  type SecurityScanCycle,
  type SecurityScanScope,
  type SecurityScanScheduleView,
  type SecurityScanPhase,
  type SecurityVerdict,
  type SecuritySeverity,
  type SecurityBranchName,
  type SecurityBranchStatus,
  type SecuritySkillView,
  type SecurityProgressView,
  type SecurityScanStateView,
  type SecurityFindingView,
  type SecurityBranchView,
  type SecuritySkippedFileView,
  type SecuritySkippedReasonCode,
  type SecurityReportView,
  type SecurityHistoryView,
  type SecurityModelConfigView,
  type SecurityRuntimeCapabilityView,
  type SecurityTotals,
  type SecurityTaskFindingView,
  type SecurityScanTaskView,
} from "./presentation/security-view";
export {
  getDesktopSecurityClient,
  reportView,
  stateView,
  historyView,
  type SecurityClient,
  type DesktopSecurityClient,
  type SecurityModelConfigUpdate,
} from "./query/desktop-client";
export {
  getBrowserSecurityClient,
  connectBrowserSecurityClient,
  isCompanionOrigin,
  type CompanionSecurityClientError,
} from "./query/browser-client";
