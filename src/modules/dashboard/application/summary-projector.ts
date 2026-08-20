import { createDashboardV2View } from "./v2.ts";
import type { Locale } from "../../../lib/i18n/locale.ts";
import type {
  DashboardSummaryCore,
  DashboardWindowSummary,
} from "../summary-contracts.ts";
import type { DashboardV2Snapshot } from "../contracts.ts";
import type {
  ReadModelMeta,
  ReadModelStatus,
} from "../../../lib/read-model/contracts.ts";
import { createProjectorCache } from "../../../lib/read-model/projector-cache.ts";

/**
 * P1-T1-03: Server-side dashboard summary projector.
 *
 * Pre-aggregates the four standard windows (today / 7d / 30d / all) plus a
 * shared daily bucket series from the browser-safe V2 snapshot. The renderer
 * consumes only this compact projection — never raw events. A bounded
 * revision-keyed cache returns the same projection for the same snapshot
 * revision + locale, so repeated page loads within one revision do no
 * re-aggregation.
 *
 * Custom date ranges (T1-05) reuse `createDashboardV2View(snapshot, "custom",
 * from, to)` so the projected numbers are bit-identical to the legacy golden
 * path; the renderer still receives only the aggregated window, never events.
 */

export interface DashboardSummaryProjector {
  build(input: {
    readonly snapshot: DashboardV2Snapshot;
    readonly locale: Locale;
    readonly generatedAt?: string;
    readonly status?: ReadModelStatus;
    /** Optional tool filter; when set every window is scoped to that source. */
    readonly toolId?: string | null;
  }): DashboardSummaryCore;
  /** Custom-range window projection (T1-05); range bounds enforced by the query layer. */
  buildCustomWindow(input: {
    readonly snapshot: DashboardV2Snapshot;
    readonly locale: Locale;
    readonly from: string;
    readonly to: string;
    readonly toolId?: string | null;
  }): { readonly meta: ReadModelMeta; readonly window: DashboardWindowSummary };
  /** Clears the in-memory projection cache (tests / policy changes). */
  clearCache(): void;
}

interface DailyTotals {
  date: string;
  totals: {
    events: number;
    inputTokens: number;
    cachedInputTokens: number;
    cacheCreationInputTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
    totalTokens: number;
  };
  sessions: number | null;
  context: {
    textResponses: number;
    toolCalls: number;
    skillCalls: number;
    toolOutputCalls: number;
  };
}

function localDateKey(timestamp: string): string | null {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function buildDailyBuckets(snapshot: DashboardV2Snapshot): DailyTotals[] {
  const rows = new Map<string, DailyTotals>();
  for (const event of snapshot.events) {
    const date = localDateKey(event.timestamp);
    if (date == null) continue;
    const current = rows.get(date) ?? {
      date,
      totals: {
        events: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
      },
      sessions: null,
      context: {
        textResponses: 0,
        toolCalls: 0,
        skillCalls: 0,
        toolOutputCalls: 0,
      },
    };
    current.totals.events += 1;
    current.totals.inputTokens += event.inputTokens;
    current.totals.cachedInputTokens += event.cachedInputTokens;
    current.totals.cacheCreationInputTokens += event.cacheCreationInputTokens;
    current.totals.outputTokens += event.outputTokens;
    current.totals.reasoningOutputTokens += event.reasoningOutputTokens;
    current.totals.totalTokens += event.totalTokens;
    current.context.textResponses += event.context.textResponses;
    current.context.toolCalls += event.context.toolCalls;
    current.context.skillCalls += event.context.skillCalls;
    current.context.toolOutputCalls += event.context.toolOutputCalls;
    rows.set(date, current);
  }
  const sessionByDate = new Map<string, number>();
  if (snapshot.sessions.available) {
    for (const row of snapshot.sessions.bySourceDay)
      sessionByDate.set(
        row.date,
        (sessionByDate.get(row.date) ?? 0) + row.count,
      );
  }
  for (const bucket of rows.values())
    bucket.sessions = snapshot.sessions.available
      ? (sessionByDate.get(bucket.date) ?? 0)
      : null;
  return [...rows.values()].sort((left, right) =>
    left.date.localeCompare(right.date),
  );
}

function windowFromView(
  period: "today" | "7d" | "30d" | "all" | "custom",
  view: ReturnType<typeof createDashboardV2View>,
): DashboardWindowSummary {
  return {
    period,
    from: view.from,
    to: view.to,
    hasData: view.hasData,
    totals: view.totals,
    estimatedCostUsd: view.estimatedCostUsd,
    estimatedCostIsPartial: view.estimatedCostIsPartial,
    cacheSavingsUsd: view.cacheSavingsUsd,
    cacheRate: view.cacheRate,
    comparison: view.comparison,
    sessions: view.sessions,
    skills: view.skills,
    activeTools: view.activeTools,
    usageSupportedToolCount: view.usageSupportedToolCount,
    modelCount: view.modelCount,
    projectCount: view.projectCount,
    trend: view.trend,
    models: view.models,
    projects: view.projects,
    context: view.context,
    contextAvailability: view.contextAvailability,
    tools: view.tools,
  };
}

function meta(
  name: string,
  revision: string,
  generatedAt: string,
  durationMs: number,
  dtoBytes: number,
  status: ReadModelStatus,
): ReadModelMeta {
  return { name, revision, generatedAt, durationMs, dtoBytes, status };
}

function scopedSnapshot(
  snapshot: DashboardV2Snapshot,
  toolId: string | null | undefined,
): DashboardV2Snapshot {
  if (!toolId) return snapshot;
  return {
    ...snapshot,
    events: snapshot.events.filter((event) => event.source === toolId),
    sessions: {
      ...snapshot.sessions,
      byProjectDay: snapshot.sessions.byProjectDay.filter(
        (row) => row.source === toolId,
      ),
      bySourceDay: snapshot.sessions.bySourceDay.filter(
        (row) => row.source === toolId,
      ),
    },
  };
}

export function createDashboardSummaryProjector(
  options: { readonly maxCacheEntries?: number } = {},
): DashboardSummaryProjector {
  const cache = createProjectorCache<DashboardSummaryCore>({
    maxEntries: options.maxCacheEntries ?? 16,
  });
  const customCache = createProjectorCache<{
    meta: ReadModelMeta;
    window: DashboardWindowSummary;
  }>({ maxEntries: options.maxCacheEntries ?? 16 });

  return {
    build({ snapshot, locale, generatedAt, status = "fresh", toolId = null }) {
      const revision = snapshot.generatedAt;
      const cached = cache.get(revision, { locale, toolId: toolId ?? "" });
      if (cached) return cached;
      const startedAt = performance.now();
      const scoped = scopedSnapshot(snapshot, toolId);
      const allView = createDashboardV2View(scoped, "all");
      const daily = buildDailyBuckets(scoped);
      const model: DashboardSummaryCore = {
        locale,
        generatedAt: generatedAt ?? snapshot.generatedAt,
        revision,
        windows: {
          today: windowFromView(
            "today",
            createDashboardV2View(scoped, "today"),
          ),
          "7d": windowFromView("7d", createDashboardV2View(scoped, "7d")),
          "30d": windowFromView("30d", createDashboardV2View(scoped, "30d")),
          all: windowFromView("all", allView),
        },
        daily: daily.map(({ date, totals, sessions, context }) => ({
          date,
          totals,
          sessions,
          context,
        })),
        tools: allView.tools,
        skills: snapshot.skills,
        outputAvailability: snapshot.outputAvailability,
        pricingAvailable: snapshot.pricingAvailable,
        calendar: allView.calendar,
        calendarSummary: allView.calendarSummary,
        meta: meta(
          "dashboard.summary",
          revision,
          snapshot.generatedAt,
          performance.now() - startedAt,
          0,
          status,
        ),
      };
      let dtoBytes = 0;
      try {
        dtoBytes = Buffer.byteLength(JSON.stringify(model), "utf8");
      } catch {
        dtoBytes = 0;
      }
      const withBytes: DashboardSummaryCore = {
        ...model,
        meta: { ...model.meta, dtoBytes },
      };
      cache.set(revision, { locale, toolId: toolId ?? "" }, withBytes);
      return withBytes;
    },

    buildCustomWindow({ snapshot, locale, from, to, toolId = null }) {
      const revision = snapshot.generatedAt;
      const params = { locale, from, to, toolId: toolId ?? "" };
      const cached = customCache.get(revision, params);
      if (cached) return cached;
      const startedAt = performance.now();
      const view = createDashboardV2View(
        scopedSnapshot(snapshot, toolId),
        "custom",
        from,
        to,
      );
      const window = windowFromView("custom", view);
      const result = {
        meta: meta(
          "dashboard.summary.custom",
          revision,
          snapshot.generatedAt,
          performance.now() - startedAt,
          0,
          "fresh",
        ),
        window,
      };
      let dtoBytes = 0;
      try {
        dtoBytes = Buffer.byteLength(JSON.stringify(window), "utf8");
      } catch {
        dtoBytes = 0;
      }
      const withBytes = {
        meta: { ...result.meta, dtoBytes },
        window: result.window,
      };
      customCache.set(revision, params, withBytes);
      return withBytes;
    },

    clearCache() {
      cache.clear();
      customCache.clear();
    },
  };
}
