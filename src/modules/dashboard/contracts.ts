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
import type { MonitoringStatus } from "../monitoring/index.ts";

/** Browser-safe usage event. Raw commands and filesystem references are omitted. */
export interface DashboardUsageEvent extends LocalTokenCounts {
  readonly source: LocalUsageEvent["source"];
  readonly timestamp: string;
  readonly model: string;
  /** Display-only project key, never a local path. */
  readonly project: string;
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
/**
 * A server-composed session count for one display-safe project and local day.
 * It deliberately contains neither session ids nor local paths, so dashboard
 * project rows can be useful without turning the dashboard into a session
 * browser.
 */
export interface DashboardProjectSessionAggregate {
  readonly project: string;
  readonly source: string;
  readonly date: string;
  readonly count: number;
  readonly turns: number;
  readonly editTurns: number;
  readonly subagentCalls: number;
}

/** Same privacy boundary as project aggregates, grouped for tool workflow KPIs. */
export interface DashboardSourceSessionAggregate {
  readonly source: string;
  readonly date: string;
  readonly count: number;
  readonly turns: number;
  readonly editTurns: number;
  readonly subagentCalls: number;
}

export interface DashboardSessionsSummary {
  readonly available: boolean;
  readonly generatedAt: string | null;
  readonly byProjectDay: readonly DashboardProjectSessionAggregate[];
  readonly bySourceDay: readonly DashboardSourceSessionAggregate[];
}

/**
 * Dashboard V2 deliberately uses a narrower renderer contract than the legacy
 * snapshot above. It is composed from local data on the server, but never
 * carries a session id, a filesystem location, a command, or raw context
 * payload into the browser.
 */
export interface DashboardV2Event extends LocalTokenCounts {
  readonly source: LocalUsageEvent["source"];
  readonly timestamp: string;
  readonly model: string;
  /** Display-only project label, derived from the final project segment. */
  readonly project: string;
  readonly context: {
    readonly textResponses: number;
    readonly toolCalls: number;
    readonly skillCalls: number;
    readonly toolOutputCalls: number;
  };
  /** Field-level evidence prevents an unobserved metric from rendering as zero. */
  readonly evidence: DashboardV2ContextAvailability;
}

export interface DashboardV2ContextAvailability {
  readonly textResponses: boolean;
  readonly toolCalls: boolean;
  readonly skillCalls: boolean;
  readonly toolOutputCalls: boolean;
  readonly reasoningTokens: boolean;
  readonly systemPromptTokens: boolean;
}

export interface DashboardV2Tool {
  readonly id: string;
  readonly name: string;
  readonly available: boolean;
  readonly detected: boolean;
  readonly usageSupport: "native" | "adapter" | "unsupported";
}

export interface DashboardV2AvailabilityMetric {
  readonly count: number | null;
  readonly available: boolean;
}

export interface DashboardV2OutputAvailability {
  readonly securityRuns: DashboardV2AvailabilityMetric;
  readonly distillationOutputs: DashboardV2AvailabilityMetric;
  readonly dailyReports: DashboardV2AvailabilityMetric;
}

export interface DashboardV2Snapshot {
  readonly generatedAt: string;
  readonly mode: LocalUsageSnapshot["mode"];
  readonly events: readonly DashboardV2Event[];
  readonly tools: readonly DashboardV2Tool[];
  readonly skills: DashboardSkillSummary;
  readonly sessions: DashboardSessionsSummary;
  readonly pricingAvailable: boolean;
  readonly outputAvailability: DashboardV2OutputAvailability;
}

export interface DashboardV2TrendPoint {
  readonly date: string;
  readonly tokens: number;
  readonly events: number;
}

export interface DashboardV2CalendarPoint extends DashboardV2TrendPoint {
  /** A zero-fill cell is range coverage, not a missing scanner result. */
  readonly active: boolean;
}

export interface DashboardV2CalendarSummary {
  readonly days: number;
  readonly activeDays: number;
  readonly longestStreak: number;
  readonly totalTokens: number;
}

export interface DashboardV2BreakdownRow {
  readonly key: string;
  readonly tokens: number;
  readonly events: number;
  readonly share: number;
  /** Null represents unavailable pricing, not a free model. */
  readonly estimatedCostUsd: number | null;
  readonly estimatedCostIsPartial: boolean;
  /** Equal-length previous window value when there is enough observed data. */
  readonly previousTokens: number | null;
  /** Percent change against previousTokens; null means not comparable. */
  readonly deltaPercent: number | null;
  /** Present for projects only, aggregated on the server without session ids. */
  readonly sessions: number | null;
}

export interface DashboardV2MetricDelta {
  readonly previous: number | null;
  readonly deltaPercent: number | null;
}

export interface DashboardV2CacheDelta extends DashboardV2MetricDelta {
  /** Cache rate is compared in percentage points, rather than token volume. */
  readonly deltaPoints: number | null;
}

export interface DashboardV2Comparison {
  readonly tokens: DashboardV2MetricDelta;
  readonly events: DashboardV2MetricDelta;
  readonly cost: DashboardV2MetricDelta;
  readonly cacheRate: DashboardV2CacheDelta;
}

export interface DashboardV2ContextCounts {
  readonly textResponses: number;
  readonly toolCalls: number;
  readonly skillCalls: number;
  readonly toolOutputCalls: number;
}

/** A presentation-neutral observation assembled from locally observed data. */
export type DashboardV2InsightKind =
  "usage" | "cache" | "cost" | "monitoring" | "security" | "empty";

export interface DashboardV2Insight {
  readonly id: DashboardV2InsightKind;
  readonly kind: DashboardV2InsightKind;
  readonly toolName?: string;
  readonly tokens?: number;
  readonly cacheRate?: number;
  readonly estimatedCostUsd?: number;
  readonly riskCount?: number;
}

export type DashboardV2MonitoringHealth =
  "listening" | "available" | "degraded" | "unavailable";

/** Derived solely from the monitoring module's renderer-safe DTO. */
export interface DashboardV2MonitoringView {
  readonly health: DashboardV2MonitoringHealth;
  readonly isLive: boolean;
  readonly liveTools: number;
  readonly detectedTools: number;
  readonly pendingCount: number;
}

export interface DashboardV2HeroView {
  readonly insights: readonly DashboardV2Insight[];
  readonly monitoring: DashboardV2MonitoringView;
}

/** Complete, period-specific and renderer-safe V2 view model. */
export interface DashboardV2View {
  readonly period: import("../../lib/local-usage/presentation.ts").UsagePeriod;
  readonly from: string | null;
  readonly to: string | null;
  readonly hasData: boolean;
  readonly totals: LocalUsageTotals;
  readonly estimatedCostUsd: number | null;
  readonly estimatedCostIsPartial: boolean;
  /** Null when the selected events do not expose any input-token denominator. */
  readonly cacheRate: number | null;
  /** Only emitted when an equal-length prior window has sufficient evidence. */
  readonly comparison: DashboardV2Comparison;
  readonly sessions: number | null;
  readonly skills: number | null;
  readonly activeTools: number;
  readonly usageSupportedToolCount: number;
  /** Full cardinality before any presentation Top-N projection. */
  readonly modelCount: number;
  readonly projectCount: number;
  readonly outputAvailability: DashboardV2OutputAvailability;
  readonly tools: readonly (DashboardV2Tool & {
    readonly tokens: number;
    readonly events: number;
  })[];
  readonly trend: readonly DashboardV2TrendPoint[];
  readonly models: readonly DashboardV2BreakdownRow[];
  readonly projects: readonly DashboardV2BreakdownRow[];
  readonly calendar: readonly DashboardV2CalendarPoint[];
  readonly calendarSummary: DashboardV2CalendarSummary;
  readonly context: DashboardV2ContextCounts;
  readonly contextAvailability: DashboardV2ContextAvailability;
}

/** Inputs accepted by the dashboard query. Infrastructure stays behind the API adapter. */
export interface DashboardQuery {
  readonly locale: Locale;
  readonly snapshot: DashboardUsageSnapshot;
  readonly pricing: PricingSnapshot | null;
  readonly skills: DashboardSkillSummary;
  readonly sessions: DashboardSessionsSummary;
  /** Null only when the public monitoring-status read could not be completed. */
  readonly monitoring: MonitoringStatus | null;
  readonly error: string | null;
  /** Privacy-safe aggregates; raw project refs/insight evidence never cross the route boundary. */
  readonly projectCount?: number;
  readonly activeInsightCount?: number;
  readonly v2: DashboardV2Snapshot;
}

/** Server loader result shared by the route and desktop adapters. */
export type DashboardReadModel = DashboardQuery;

export interface DashboardSelection {
  readonly events: readonly LocalUsageEvent[];
  readonly totals: LocalUsageTotals;
  readonly cost: CostEstimate;
}
