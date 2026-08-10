export const dashboardModuleId = "dashboard" as const;
export type DashboardModuleId = typeof dashboardModuleId;
export interface DashboardModuleContract {
  readonly module: DashboardModuleId;
  readonly schemaVersion: 1;
}

import type {
  LocalTokenCounts,
  LocalUsageContext,
  LocalUsageBreakdown,
  LocalUsageDaily,
  LocalUsageEvent,
  LocalUsageSnapshot,
  LocalUsageSourceSummary,
  LocalUsageTotals,
} from "../../lib/local-usage/types.ts";
import type { CostEstimate, PricingSnapshot } from "../../lib/pricing";
import type { Locale } from "../../lib/i18n/locale";

/** Browser-safe usage event. Raw commands and filesystem references are omitted. */
export interface DashboardUsageEvent extends LocalTokenCounts {
  readonly source: LocalUsageEvent["source"];
  readonly timestamp: string;
  readonly model: string;
  /** Display-only project key, never a local path. */
  readonly project: string;
  /** Opaque id used only for distinct session counting. */
  readonly sessionId?: string;
  readonly context?: Pick<
    LocalUsageContext,
    "textResponse" | "tools" | "skills" | "toolOutputs"
  >;
}

/** Scanner status with roots, file paths and diagnostic payloads removed. */
export type DashboardUsageSource = Pick<
  LocalUsageSourceSummary,
  | "source"
  | "available"
  | "detected"
  | "filesConsidered"
  | "filesRead"
  | "filesReused"
  | "filesParsed"
  | "malformedLines"
  | "events"
>;

export interface DashboardUsageSnapshot {
  readonly generatedAt: string;
  readonly mode: LocalUsageSnapshot["mode"];
  readonly sources: DashboardUsageSource[];
  readonly events: number;
  readonly totals: LocalUsageTotals;
  readonly bySource: LocalUsageBreakdown[];
  readonly byModel: LocalUsageBreakdown[];
  readonly byProject: LocalUsageBreakdown[];
  readonly daily: LocalUsageDaily[];
  readonly details: DashboardUsageEvent[];
  readonly recent: DashboardUsageEvent[];
}

/** The dashboard needs availability/count only; detailed skill data stays in its module. */
export interface DashboardSkillSummary {
  readonly available: boolean;
  readonly count: number;
  readonly generatedAt: string | null;
}

/** Session metrics use the existing public sessions DTO, pared to dashboard needs. */
export interface DashboardSessionRecord {
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationMs: number;
  readonly turns: number;
  readonly editTurns: number;
}

export interface DashboardSessionsSummary {
  readonly available: boolean;
  readonly generatedAt: string | null;
  readonly records: DashboardSessionRecord[];
}

/** Inputs accepted by the dashboard query. Infrastructure stays behind the API adapter. */
export interface DashboardQuery {
  readonly locale: Locale;
  readonly snapshot: DashboardUsageSnapshot;
  readonly pricing: PricingSnapshot | null;
  readonly skills: DashboardSkillSummary;
  readonly sessions: DashboardSessionsSummary;
  readonly error: string | null;
  /** Privacy-safe aggregates; raw project refs/insight evidence never cross the route boundary. */
  readonly projectCount?: number;
  readonly activeInsightCount?: number;
}

/** Server loader result shared by the route and desktop adapters. */
export type DashboardReadModel = DashboardQuery;

export interface DashboardSelection {
  readonly events: readonly LocalUsageEvent[];
  readonly totals: LocalUsageTotals;
  readonly cost: CostEstimate;
}
