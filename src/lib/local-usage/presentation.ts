import { PUBLIC_TOOL_MANIFEST } from "../tool-registry/public-manifest.generated.ts";
import type {
  LocalTokenCounts,
  LocalUsageBreakdown,
  LocalUsageDaily,
  LocalUsageEvent,
  LocalUsageSnapshot,
  LocalUsageSource,
  LocalUsageTotals,
} from "./types.ts";

export type UsagePeriod =
  "today" | "week" | "7d" | "30d" | "month" | "year" | "all" | "custom";
export type UsageTimeGrain = "day" | "hour";

export interface UsageRange {
  from: string | null;
  to: string | null;
  fromDate: Date | null;
  toDate: Date | null;
  valid: boolean;
  reason?: "missing-boundary" | "invalid-boundary" | "reversed-range";
}

export interface TimeBucket extends LocalUsageTotals {
  key: string;
  label: string;
}

export interface SessionUsageRow extends LocalUsageTotals {
  sessionId: string;
}

export interface SessionUsageSummary {
  available: boolean;
  rows: SessionUsageRow[];
  eventsWithSession: number;
  eventsWithoutSession: number;
}

const EMPTY_COUNTS: LocalTokenCounts = {
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheCreationInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 0,
};

export function createEmptyUsageSnapshot(): LocalUsageSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    mode: "empty",
    sources: [
      {
        source: "claude-code",
        available: false,
        filesConsidered: 0,
        filesRead: 0,
        filesReused: 0,
        filesParsed: 0,
        malformedLines: 0,
        events: 0,
      },
      {
        source: "codex",
        available: false,
        filesConsidered: 0,
        filesRead: 0,
        filesReused: 0,
        filesParsed: 0,
        malformedLines: 0,
        events: 0,
      },
    ],
    events: 0,
    totals: { events: 0, ...EMPTY_COUNTS },
    bySource: [],
    byModel: [],
    byProject: [],
    daily: [],
    details: [],
    recent: [],
  };
}

/**
 * Browser-facing source label (F6-T2): projected from the public manifest's
 * `nameZh` — the UI display-name convention used by the sources page and the
 * skill-agent labels (SKILL_AGENTS). Unknown ids (e.g. a legacy source that
 * left the registry) fall back to the raw id.
 */
const MANIFEST_SOURCE_LABELS: ReadonlyMap<string, string> = new Map(
  PUBLIC_TOOL_MANIFEST.tools.map((tool) => [tool.id, tool.nameZh]),
);

export function sourceLabel(source: LocalUsageSource | string): string {
  return MANIFEST_SOURCE_LABELS.get(source) ?? source;
}

// NOTE: 展示格式化统一走 src/lib/i18n/format.ts (locale 参数化)。
// 本模块只保留纯数据逻辑;formatTokens/formatDateTime/formatEventTime
// 的调用方改用 useI18n().format.*。

export function filterDailyUsage(
  daily: LocalUsageDaily[],
  period: UsagePeriod,
  customFrom?: string,
  customTo?: string,
  now = new Date(),
): LocalUsageDaily[] {
  const range = resolveUsageRange(period, customFrom, customTo, now);
  if (!range.valid || range.from == null || range.to == null) return [];
  const from = range.from;
  const to = range.to;
  return daily.filter((row) => row.date >= from && row.date <= to);
}

export function filterUsageEvents(
  events: LocalUsageEvent[],
  period: UsagePeriod,
  customFrom?: string,
  customTo?: string,
  now = new Date(),
): LocalUsageEvent[] {
  const range = resolveUsageRange(period, customFrom, customTo, now);
  if (!range.valid || range.fromDate == null || range.toDate == null) return [];
  const fromDate = range.fromDate;
  const toDate = range.toDate;
  return events.filter((event) => {
    const timestamp = new Date(event.timestamp);
    if (Number.isNaN(timestamp.getTime())) return false;
    return timestamp >= fromDate && timestamp <= toDate;
  });
}

export function totalsFromDaily(daily: LocalUsageDaily[]): LocalUsageTotals {
  return daily.reduce<LocalUsageTotals>(
    (totals, row) => ({
      events: totals.events + row.events,
      inputTokens: totals.inputTokens + row.inputTokens,
      cachedInputTokens: totals.cachedInputTokens + row.cachedInputTokens,
      cacheCreationInputTokens:
        totals.cacheCreationInputTokens + row.cacheCreationInputTokens,
      outputTokens: totals.outputTokens + row.outputTokens,
      reasoningOutputTokens:
        totals.reasoningOutputTokens + row.reasoningOutputTokens,
      totalTokens: totals.totalTokens + row.totalTokens,
    }),
    { events: 0, ...EMPTY_COUNTS },
  );
}

export function cacheRate(counts: LocalTokenCounts): number {
  const inputTotal =
    counts.inputTokens +
    counts.cachedInputTokens +
    counts.cacheCreationInputTokens;
  return inputTotal ? (counts.cachedInputTokens / inputTotal) * 100 : 0;
}

export function shareOf(value: number, total: number): number {
  return total ? (value / total) * 100 : 0;
}

/**
 * Compute the period-over-period (环比) percentage for a metric.
 *
 * 环比 = (current − previous) / previous × 100%. For the "all"/"year" ranges
 * there is no well-defined previous equal-length window, so this returns null
 * (the UI renders "−−"). Returns null whenever previous is 0 or non-finite to
 * avoid division-by-zero or misleading infinity deltas.
 */
export function computeMoM(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/**
 * Resolve the previous equal-length window for a range, used to feed
 * `computeMoM`. Returns null for ranges with no well-defined previous window
 * ("all", "year", and "custom" — custom spans are arbitrary so the previous
 * window is ambiguous).
 */
export function resolvePreviousRange(
  period: UsagePeriod,
  customFrom?: string,
  customTo?: string,
  now = new Date(),
): UsageRange | null {
  if (period === "all" || period === "year" || period === "custom") return null;
  const range = resolveUsageRange(period, customFrom, customTo, now);
  if (!range.valid || range.from == null || range.to == null) return null;
  const fromStart = startOfLocalDay(range.from);
  const toEnd = endOfLocalDay(range.to);
  if (fromStart == null || toEnd == null) return null;
  const spanMs = toEnd.getTime() - fromStart.getTime();
  const prevTo = new Date(fromStart.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - spanMs);
  const prevFromKey = localDateKey(prevFrom);
  const prevToKey = localDateKey(prevTo);
  return {
    from: prevFromKey,
    to: prevToKey,
    fromDate: prevFrom,
    toDate: prevTo,
    valid: true,
  };
}

/**
 * Sum a numeric metric over the events that fall in the given period's
 * previous window. Returns null when there is no previous window ("all"/"year"
 * /"custom") so callers can render "−−".
 */
export function previousPeriodTotal(
  events: LocalUsageEvent[],
  metric: keyof LocalTokenCounts | "events",
  period: UsagePeriod,
  customFrom?: string,
  customTo?: string,
  now = new Date(),
): number | null {
  const prev = resolvePreviousRange(period, customFrom, customTo, now);
  if (prev == null || prev.fromDate == null || prev.toDate == null) return null;
  const isEvents = metric === "events";
  const tokenMetric = metric as keyof LocalTokenCounts;
  let total = 0;
  for (const event of events) {
    const timestamp = new Date(event.timestamp);
    if (Number.isNaN(timestamp.getTime())) continue;
    if (timestamp >= prev.fromDate && timestamp <= prev.toDate) {
      total += isEvents ? 1 : event[tokenMetric];
    }
  }
  return total;
}

/**
 * Compose the token breakdown for a row. `label` is a stable i18n message key
 * (dashboard.tokens.*) — components translate it at the display boundary.
 */
export function breakdownComposition(row: LocalUsageBreakdown) {
  return [
    {
      label: "dashboard.tokens.input",
      value: row.inputTokens,
      color: "var(--color-chart-1)",
    },
    {
      label: "dashboard.tokens.output",
      value: row.outputTokens,
      color: "var(--color-chart-2)",
    },
    {
      label: "dashboard.tokens.cacheRead",
      value: row.cachedInputTokens,
      color: "var(--color-chart-3)",
    },
    {
      label: "dashboard.tokens.cacheWrite",
      value: row.cacheCreationInputTokens,
      color: "var(--color-chart-5)",
    },
    {
      label: "dashboard.tokens.reasoning",
      value: row.reasoningOutputTokens,
      color: "var(--color-chart-4)",
    },
  ].filter((item) => item.value > 0);
}

export function aggregateEventsByTime(
  events: LocalUsageEvent[],
  grain: UsageTimeGrain,
): TimeBucket[] {
  const buckets = new Map<string, LocalUsageTotals>();

  for (const event of events) {
    const timestamp = new Date(event.timestamp);
    if (Number.isNaN(timestamp.getTime())) continue;
    const key =
      grain === "hour" ? localHourKey(timestamp) : localDateKey(timestamp);
    const totals = buckets.get(key) ?? { events: 0, ...EMPTY_COUNTS };
    totals.events += 1;
    totals.inputTokens += event.inputTokens;
    totals.cachedInputTokens += event.cachedInputTokens;
    totals.cacheCreationInputTokens += event.cacheCreationInputTokens;
    totals.outputTokens += event.outputTokens;
    totals.reasoningOutputTokens += event.reasoningOutputTokens;
    totals.totalTokens += event.totalTokens;
    buckets.set(key, totals);
  }

  return [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, totals]) => ({
      key,
      label:
        grain === "hour" ? key.slice(5, 13).replace("T", " ") : key.slice(5),
      ...totals,
    }));
}

export function aggregateUsageBySession(
  events: LocalUsageEvent[],
): SessionUsageSummary {
  const rows = new Map<string, LocalUsageTotals>();
  let eventsWithSession = 0;
  let eventsWithoutSession = 0;

  for (const event of events) {
    const sessionId = event.sessionId?.trim();
    if (sessionId == null || sessionId.length === 0) {
      eventsWithoutSession += 1;
      continue;
    }
    eventsWithSession += 1;
    const totals = rows.get(sessionId) ?? { events: 0, ...EMPTY_COUNTS };
    totals.events += 1;
    totals.inputTokens += event.inputTokens;
    totals.cachedInputTokens += event.cachedInputTokens;
    totals.cacheCreationInputTokens += event.cacheCreationInputTokens;
    totals.outputTokens += event.outputTokens;
    totals.reasoningOutputTokens += event.reasoningOutputTokens;
    totals.totalTokens += event.totalTokens;
    rows.set(sessionId, totals);
  }

  return {
    available: rows.size > 0,
    rows: [...rows.entries()]
      .map(([sessionId, totals]) => ({ sessionId, ...totals }))
      .sort(
        (left, right) =>
          right.totalTokens - left.totalTokens ||
          left.sessionId.localeCompare(right.sessionId),
      ),
    eventsWithSession,
    eventsWithoutSession,
  };
}

export function resolveUsageRange(
  period: UsagePeriod,
  customFrom?: string,
  customTo?: string,
  now = new Date(),
): UsageRange {
  const today = localDateKey(now);
  let from = today;
  let to = today;

  if (period === "7d") from = localDateKey(addDays(now, -6));
  if (period === "30d") from = localDateKey(addDays(now, -29));
  if (period === "week") {
    const day = now.getDay();
    from = localDateKey(addDays(now, -(day === 0 ? 6 : day - 1)));
  }
  if (period === "month") {
    from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  }
  if (period === "year") {
    from = `${now.getFullYear()}-01-01`;
  }
  if (period === "all") {
    // "All" covers every recorded event from the dawn of time to today. The
    // exact lower bound comes from the data; here we use an early sentinel so
    // every real timestamp falls inside the range.
    from = "1970-01-01";
    to = today;
  }
  if (period === "custom") {
    if (
      customFrom == null ||
      customTo == null ||
      customFrom === "" ||
      customTo === ""
    ) {
      return {
        from: customFrom ?? null,
        to: customTo ?? null,
        fromDate: null,
        toDate: null,
        valid: false,
        reason: "missing-boundary",
      };
    }
    from = customFrom;
    to = customTo;
  }

  const fromDate = startOfLocalDay(from);
  const toDate = endOfLocalDay(to);
  if (fromDate == null || toDate == null) {
    return {
      from,
      to,
      fromDate,
      toDate,
      valid: false,
      reason: "invalid-boundary",
    };
  }
  if (fromDate > toDate) {
    return {
      from,
      to,
      fromDate,
      toDate,
      valid: false,
      reason: "reversed-range",
    };
  }

  return { from, to, fromDate, toDate, valid: true };
}

function addDays(value: Date, days: number): Date {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function localDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localHourKey(value: Date): string {
  return `${localDateKey(value)}T${String(value.getHours()).padStart(2, "0")}`;
}

function startOfLocalDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function endOfLocalDay(value: string): Date | null {
  const date = startOfLocalDay(value);
  if (date == null) return null;
  date.setHours(23, 59, 59, 999);
  return date;
}
