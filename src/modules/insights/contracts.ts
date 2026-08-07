export const insightsModuleId = "insights" as const;
export type InsightsModuleId = typeof insightsModuleId;
export interface InsightsModuleContract {
  readonly module: InsightsModuleId;
  readonly schemaVersion: 1;
}

export type InsightSeverity = "info" | "low" | "medium" | "high" | "critical";
export type InsightStatus = "active" | "resolved" | "unknown";
export type InsightFreshness = "fresh" | "stale" | "unknown";
export type InsightUncertainty = "none" | "partial" | "high";

/** A reference safe to expose to a renderer. `ref` is opaque and never a path. */
export interface EvidenceRef {
  readonly module: "usage" | "security" | "tasks" | "knowledge";
  readonly ref: string;
  readonly observedAt: string;
}

export interface Insight {
  readonly id: string;
  readonly code: string;
  readonly severity: InsightSeverity;
  readonly status: InsightStatus;
  readonly freshness: InsightFreshness;
  readonly uncertainty: InsightUncertainty;
  readonly titleKey: `insights.${string}`;
  readonly messageKey: `insights.${string}`;
  readonly observedAt: string;
  readonly evidence: readonly EvidenceRef[];
}

export interface InsightSnapshot {
  readonly generatedAt: string;
  readonly freshness: InsightFreshness;
  readonly insights: readonly Insight[];
}

export interface UsageInsightInput {
  readonly observedAt: string;
  readonly events: number;
  readonly totalTokens: number;
  readonly cost?: {
    readonly knownUsd?: number;
    readonly estimatedUsd?: number;
    readonly unknownEvents?: number;
    readonly complete?: boolean;
  };
  readonly failedSources?: number;
}

export interface SecurityInsightInput {
  readonly observedAt: string;
  readonly findings: readonly {
    readonly ref: string;
    readonly severity: InsightSeverity;
    readonly status?: "active" | "resolved";
  }[];
  readonly truncated?: boolean;
}

export interface JobInsightInput {
  readonly observedAt: string;
  readonly runs: readonly {
    readonly ref: string;
    readonly taskId: string;
    readonly status:
      | "queued"
      | "running"
      | "succeeded"
      | "failed"
      | "cancelled"
      | "skipped"
      | "abandoned";
    readonly errorCode?: `errors.${string}`;
    readonly uncertainty?: boolean;
  }[];
}

export interface KnowledgeInsightInput {
  readonly observedAt: string;
  readonly pending: number;
  readonly failed: number;
  readonly unsafe: number;
  readonly refs?: readonly string[];
}

export interface InsightsInput {
  readonly usage?: UsageInsightInput;
  readonly security?: SecurityInsightInput;
  readonly jobs?: JobInsightInput;
  readonly knowledge?: KnowledgeInsightInput;
}

export interface InsightsClock {
  readonly now: () => Date;
}

export interface StalePolicy {
  readonly maxAgeMs: number;
}
