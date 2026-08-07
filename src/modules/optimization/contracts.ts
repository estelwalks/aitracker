export const optimizationModuleId = "optimization" as const;
export type OptimizationModuleId = typeof optimizationModuleId;
export interface OptimizationModuleContract {
  readonly module: OptimizationModuleId;
  readonly schemaVersion: 1;
}

import type { ProjectUsageReadModel } from "../projects/contracts.ts";
import type { LocalUsageSnapshot } from "../../lib/local-usage/types.ts";

export type OptimizationSeverity =
  "critical" | "high" | "medium" | "low" | "info";
export type OptimizationConfidence = "exact" | "estimated" | "unknown";
export type OptimizationFindingCode =
  | "high-cost"
  | "low-cache-hit-rate"
  | "unknown-price"
  | "duplicate-configuration"
  | "project-anomaly";

export interface OptimizationEvidence {
  readonly module: "usage" | "projects" | "pricing" | "optimization";
  /** Opaque, deterministic reference; never a path, command, token, or prompt. */
  readonly evidenceRef: string;
  readonly observedAt: string;
}

export interface OptimizationImpact {
  readonly kind: "cost" | "savings" | "coverage" | "efficiency";
  readonly confidence: OptimizationConfidence;
  /** Amount is omitted for unknown pricing and is never a fabricated zero. */
  readonly amountUsd?: number;
  readonly unit?: "usd" | "ratio" | "events" | "projects";
}

export interface OptimizationRecommendation {
  readonly id: string;
  readonly action:
    "review-pricing" | "review-cache" | "deduplicate-config" | "review-project";
  readonly priority: OptimizationSeverity;
  readonly rationale: string;
  readonly evidenceRef: string;
  readonly estimatedImpact: OptimizationImpact;
}

export interface OptimizationFinding {
  readonly id: string;
  readonly code: OptimizationFindingCode;
  readonly severity: OptimizationSeverity;
  readonly title: string;
  readonly rationale: string;
  readonly evidenceRef: string;
  readonly recommendation?: OptimizationRecommendation;
  readonly estimatedImpact?: OptimizationImpact;
  readonly projectId?: string;
}

export interface DuplicateConfigurationSummary {
  readonly key: string;
  readonly count: number;
}

export interface OptimizationThresholds {
  readonly highCostUsd: number;
  readonly minimumCacheTokens: number;
  readonly minimumCacheHitRate: number;
  readonly unknownProjectEvents: number;
}

export interface OptimizationInput {
  readonly usage?: LocalUsageSnapshot;
  readonly projects?: ProjectUsageReadModel;
  readonly duplicateConfigurations?: readonly DuplicateConfigurationSummary[];
  readonly observedAt?: string;
  readonly thresholds?: Partial<OptimizationThresholds>;
}

export interface OptimizationSnapshot {
  readonly generatedAt: string;
  readonly findings: readonly OptimizationFinding[];
}
