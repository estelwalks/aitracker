import type {
  LocalTokenCounts,
  LocalUsageBreakdown,
  LocalUsageDaily,
  LocalUsageEvent,
  LocalUsageSnapshot,
  LocalUsageSource,
  LocalUsageTotals,
} from "./types.ts";

export type UsagePeriod = "today" | "week" | "7d" | "30d" | "month" | "year" | "custom";
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

export function sourceLabel(source: LocalUsageSource | string): string {
  if (source === "claude-code") return "Claude Code";
  if (source === "codex") return "Codex";
  if (source === "aipy" || source === "custom:aipy") return "Aipy";
  if (source === "workbuddy" || source === "custom:workbuddy") return "WorkBuddy";
  if (source.startsWith("custom:")) return source.slice("custom:".length);
  return source;
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000_000) return `${trimFixed(value / 1_000_000_000)}B`;
  if (value >= 1_000_000) return `${trimFixed(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trimFixed(value / 1_000)}K`;
  return Math.round(value).toLocaleString();
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatEventTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

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
      cacheCreationInputTokens: totals.cacheCreationInputTokens + row.cacheCreationInputTokens,
      outputTokens: totals.outputTokens + row.outputTokens,
      reasoningOutputTokens: totals.reasoningOutputTokens + row.reasoningOutputTokens,
      totalTokens: totals.totalTokens + row.totalTokens,
    }),
    { events: 0, ...EMPTY_COUNTS },
  );
}

export function cacheRate(counts: LocalTokenCounts): number {
  const inputTotal =
    counts.inputTokens + counts.cachedInputTokens + counts.cacheCreationInputTokens;
  return inputTotal ? (counts.cachedInputTokens / inputTotal) * 100 : 0;
}

export function shareOf(value: number, total: number): number {
  return total ? (value / total) * 100 : 0;
}

export function breakdownComposition(row: LocalUsageBreakdown) {
  return [
    { label: "输入", value: row.inputTokens, color: "var(--color-chart-1)" },
    { label: "输出", value: row.outputTokens, color: "var(--color-chart-2)" },
    { label: "缓存读取", value: row.cachedInputTokens, color: "var(--color-chart-3)" },
    {
      label: "缓存写入",
      value: row.cacheCreationInputTokens,
      color: "var(--color-chart-5)",
    },
    {
      label: "推理",
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
    const key = grain === "hour" ? localHourKey(timestamp) : localDateKey(timestamp);
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
      label: grain === "hour" ? key.slice(5, 13).replace("T", " ") : key.slice(5),
      ...totals,
    }));
}

export function aggregateUsageBySession(events: LocalUsageEvent[]): SessionUsageSummary {
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
          right.totalTokens - left.totalTokens || left.sessionId.localeCompare(right.sessionId),
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
  if (period === "custom") {
    if (customFrom == null || customTo == null || customFrom === "" || customTo === "") {
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

function trimFixed(value: number): string {
  return value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2).replace(/\.?0+$/, "");
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
