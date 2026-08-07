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
export type { OptimizationViewModel } from "./presentation";
