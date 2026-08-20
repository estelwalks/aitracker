import type {
  WithReadModelMeta,
  ReadModelMeta,
} from "../../lib/read-model/contracts.ts";
import type { LocalUsageTotals } from "../../lib/local-usage/types.ts";
import type { Locale } from "../../lib/i18n/locale.ts";
import type { UsagePeriod } from "../../lib/local-usage/presentation.ts";
import type { MonitoringStatus } from "../monitoring/contracts.ts";
import type {
  DashboardV2Tool,
  DashboardV2OutputAvailability,
  DashboardV2TrendPoint,
  DashboardV2BreakdownRow,
  DashboardV2Comparison,
  DashboardV2ContextCounts,
  DashboardV2ContextAvailability,
  DashboardV2CalendarPoint,
  DashboardV2CalendarSummary,
  DashboardV2HeroView,
  DashboardV2View,
} from "./contracts.ts";

/**
 * P1-T1-02: Compact Dashboard read model.
 *
 * Deliberately excludes raw events (`DashboardV2Snapshot.events`,
 * `DashboardUsageSnapshot.details`) and any server-only type. All four
 * standard windows (today / 7d / 30d / all) are pre-aggregated on the server
 * by the summary projector; the renderer never re-aggregates raw events.
 *
 * Custom date ranges (T1-05) are projected server-side over the same
 * event-derived aggregates with a bounded 366-day range and per-revision
 * memoization. The per-day `daily` buckets below are carried for lightweight
 * window math and diagnostics; dimension rows (models/projects/tools Top N)
 * are not representable from buckets alone, so custom windows are built by
 * the server projector from the snapshot — never on the browser.
 *
 * Budget: serialized JSON ≤ 250 KB (see `tests/performance/budgets.v1.json`
 * and `scripts/verify-read-model-budgets.mts`).
 */
export interface DashboardWindowSummary {
  readonly period: UsagePeriod;
  /** "YYYY-MM-DD" inclusive range this window covers (null = all observed). */
  readonly from: string | null;
  readonly to: string | null;
  readonly hasData: boolean;
  readonly totals: LocalUsageTotals;
  readonly estimatedCostUsd: number | null;
  readonly estimatedCostIsPartial: boolean;
  readonly cacheSavingsUsd: number | null;
  readonly cacheRate: number | null;
  readonly comparison: DashboardV2Comparison;
  readonly sessions: number | null;
  readonly skills: number | null;
  readonly activeTools: number;
  readonly usageSupportedToolCount: number;
  readonly modelCount: number;
  readonly projectCount: number;
  readonly trend: readonly DashboardV2TrendPoint[];
  readonly models: readonly DashboardV2BreakdownRow[];
  readonly projects: readonly DashboardV2BreakdownRow[];
  readonly context: DashboardV2ContextCounts;
  readonly contextAvailability: DashboardV2ContextAvailability;
  /** Window-scoped tool cards (tokens/events within this window). */
  readonly tools: readonly (DashboardV2Tool & {
    readonly tokens: number;
    readonly events: number;
  })[];
}

/** One pre-aggregated day bucket (T1-05 custom-range summation source). */
export interface DashboardDailyBucket {
  readonly date: string;
  readonly totals: LocalUsageTotals;
  readonly sessions: number | null;
  readonly context: DashboardV2ContextCounts;
}

export interface DashboardSummaryReadModel extends WithReadModelMeta {
  readonly locale: Locale;
  readonly generatedAt: string;
  /** Source snapshot revision the projection was built from. */
  readonly revision: string;
  /** Standard windows, pre-aggregated on the server. */
  readonly windows: Readonly<{
    today: DashboardWindowSummary;
    "7d": DashboardWindowSummary;
    "30d": DashboardWindowSummary;
    all: DashboardWindowSummary;
  }>;
  /** Per-day buckets for custom-range summation (≤ ~2 years, zero-filled). */
  readonly daily: readonly DashboardDailyBucket[];
  /** Tool cards with usage attached (shared across windows). */
  readonly tools: readonly (DashboardV2Tool & {
    readonly tokens: number;
    readonly events: number;
  })[];
  readonly skills: {
    readonly available: boolean;
    readonly count: number;
    readonly generatedAt: string | null;
  };
  readonly outputAvailability: DashboardV2OutputAvailability;
  readonly pricingAvailable: boolean;
  /** 12-month contribution heatmap (shared, all-window). */
  readonly calendar: readonly DashboardV2CalendarPoint[];
  readonly calendarSummary: DashboardV2CalendarSummary;
  /** Hero projection (Jarvis insight + monitoring) pre-built on the server. */
  readonly hero: DashboardV2HeroView;
  /** Renderer-safe monitoring status (for security cards). */
  readonly monitoring: MonitoringStatus | null;
}

/** Projector core; hero/monitoring are attached by the query adapter (T1-04). */
export type DashboardSummaryCore = Omit<
  DashboardSummaryReadModel,
  "hero" | "monitoring"
>;

/** Assembles a renderer view from a pre-aggregated window (T1-04). */
export function windowToView(
  window: DashboardWindowSummary,
  summary: Pick<
    DashboardSummaryReadModel,
    "calendar" | "calendarSummary" | "outputAvailability" | "monitoring"
  >,
): DashboardV2View {
  return {
    period: window.period,
    from: window.from,
    to: window.to,
    hasData: window.hasData,
    totals: window.totals,
    estimatedCostUsd: window.estimatedCostUsd,
    estimatedCostIsPartial: window.estimatedCostIsPartial,
    cacheSavingsUsd: window.cacheSavingsUsd,
    cacheRate: window.cacheRate,
    comparison: window.comparison,
    sessions: window.sessions,
    skills: window.skills,
    activeTools: window.activeTools,
    usageSupportedToolCount: window.usageSupportedToolCount,
    modelCount: window.modelCount,
    projectCount: window.projectCount,
    outputAvailability: summary.outputAvailability,
    memoryCount: summary.outputAvailability.distillationOutputs.available
      ? summary.outputAvailability.distillationOutputs.count
      : null,
    tools: window.tools,
    trend: window.trend,
    models: window.models,
    projects: window.projects,
    calendar: summary.calendar,
    calendarSummary: summary.calendarSummary,
    context: window.context,
    contextAvailability: window.contextAvailability,
  };
}

/** Query input for the dashboard summary read model. */
export interface DashboardSummaryQueryInput {
  readonly locale: Locale;
  /** Optional custom range; when set the projector builds a custom window. */
  readonly from?: string;
  readonly to?: string;
  /** Optional tool filter (null = all tools). */
  readonly tool?: string | null;
}

/** Custom-range projection result (T1-05). */
export interface DashboardCustomWindowResult {
  readonly meta: ReadModelMeta;
  readonly window: DashboardWindowSummary;
}
