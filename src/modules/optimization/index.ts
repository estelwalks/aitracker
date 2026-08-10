export { optimizationModuleId } from "./contracts";
export type {
  OptimizationModuleContract,
  OptimizationModuleId,
  OptimizationConfidence,
  OptimizationEvidence,
  OptimizationFinding,
  OptimizationFindingCode,
  OptimizationImpact,
  OptimizationInput,
  OptimizationRecommendation,
  OptimizationSeverity,
  OptimizationSnapshot,
  OptimizationThresholds,
  DuplicateConfigurationSummary,
} from "./contracts";
export { buildOptimizationSnapshot } from "./domain.ts";
export { createOptimizationSnapshot } from "./application/index.ts";
export {
  applyApproved,
  approve,
  canTransition,
  createChangeProposal,
  reject,
  requestApproval,
  rollbackApplied,
  transitionProposal,
} from "./application/proposals/index.ts";
export type {
  ApprovalState,
  ChangeDispatchResult,
  ChangeDispatcher,
  ChangeImpact,
  ChangeOperation,
  ChangeOperationKind,
  ChangeProposal,
  ChangeRollback,
  ProposalApplicationOptions,
  ProposalAuditEvent,
  ProposalErrorCode,
  ProposalEvidence,
  ProposalInput,
} from "./application/proposals/index.ts";
export type { OptimizationViewModel } from "./presentation";
