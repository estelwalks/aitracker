import { estimateUsageCost } from "../../../lib/pricing/index.ts";
import {
  resolveUsageRange,
  type UsagePeriod,
} from "../../../lib/local-usage/presentation.ts";
import type { LocalUsageTotals } from "../../../lib/local-usage/types.ts";
import type {
  DashboardV2Insight,
  DashboardV2HeroView,
  DashboardV2BreakdownRow,
  DashboardV2CalendarPoint,
  DashboardV2CalendarSummary,
  DashboardV2ContextCounts,
  DashboardV2Event,
  DashboardV2Snapshot,
  DashboardV2TrendPoint,
  DashboardV2View,
} from "../contracts.ts";
import type { MonitoringStatus } from "../../monitoring/index.ts";

const liveWindowMs = 15 * 60 * 1000;
const heartbeatWindowMs = 20 * 60 * 1000;

const emptyTotals = (): LocalUsageTotals => ({
  events: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheCreationInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 0,
});

const emptyContext = (): DashboardV2ContextCounts => ({
  textResponses: 0,
  toolCalls: 0,
  skillCalls: 0,
  toolOutputCalls: 0,
});

function totalsFor(events: readonly DashboardV2Event[]): LocalUsageTotals {
  return events.reduce<LocalUsageTotals>((totals, event) => {
    totals.events += 1;
    totals.inputTokens += event.inputTokens;
    totals.cachedInputTokens += event.cachedInputTokens;
    totals.cacheCreationInputTokens += event.cacheCreationInputTokens;
    totals.outputTokens += event.outputTokens;
    totals.reasoningOutputTokens += event.reasoningOutputTokens;
    totals.totalTokens += event.totalTokens;
    return totals;
  }, emptyTotals());
}

function ranked(
  events: readonly DashboardV2Event[],
  keyOf: (event: DashboardV2Event) => string,
): DashboardV2BreakdownRow[] {
  const rows = new Map<
    string,
    { key: string; tokens: number; events: number }
  >();
  for (const event of events) {
    const key = keyOf(event) || "unknown";
    const current = rows.get(key) ?? { key, tokens: 0, events: 0 };
    current.tokens += event.totalTokens;
    current.events += 1;
    rows.set(key, current);
  }
  return [...rows.values()]
    .sort(
      (left, right) =>
        right.tokens - left.tokens || left.key.localeCompare(right.key),
    )
    .map((row) => ({
      ...row,
      share: 0,
      estimatedCostUsd: null,
      estimatedCostIsPartial: false,
    }));
}

function dateKey(timestamp: string): string | null {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function daily(events: readonly DashboardV2Event[]): DashboardV2TrendPoint[] {
  const rows = new Map<
    string,
    { date: string; tokens: number; events: number }
  >();
  for (const event of events) {
    const date = dateKey(event.timestamp);
    if (date == null) continue;
    const current = rows.get(date) ?? { date, tokens: 0, events: 0 };
    current.tokens += event.totalTokens;
    current.events += 1;
    rows.set(date, current);
  }
  return [...rows.values()].sort((left, right) =>
    left.date.localeCompare(right.date),
  );
}

function addLocalDays(date: Date, amount: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function calendarFor(
  trend: readonly DashboardV2TrendPoint[],
  range: ReturnType<typeof resolveUsageRange>,
): { points: DashboardV2CalendarPoint[]; summary: DashboardV2CalendarSummary } {
  if (!range.valid || !range.toDate || trend.length === 0)
    return {
      points: [],
      summary: { days: 0, activeDays: 0, longestStreak: 0 },
    };
  const observedByDate = new Map(trend.map((point) => [point.date, point]));
  // The all-time range uses a 1970 sentinel. Calendar coverage instead starts
  // with the first actual local day; we never manufacture decades of empties.
  const observedStart = new Date(`${trend[0]!.date}T00:00:00`);
  const start = range.from === "1970-01-01" ? observedStart : range.fromDate!;
  const points: DashboardV2CalendarPoint[] = [];
  for (
    let cursor = new Date(start);
    cursor <= range.toDate;
    cursor = addLocalDays(cursor, 1)
  ) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    const observed = observedByDate.get(key);
    points.push({
      date: key,
      tokens: observed?.tokens ?? 0,
      events: observed?.events ?? 0,
      active: observed != null,
    });
  }
  let streak = 0;
  let longestStreak = 0;
  for (const point of points) {
    streak = point.active ? streak + 1 : 0;
    longestStreak = Math.max(longestStreak, streak);
  }
  return {
    points,
    summary: {
      days: points.length,
      activeDays: points.filter((point) => point.active).length,
      longestStreak,
    },
  };
}

function enrichRows(
  rows: readonly DashboardV2BreakdownRow[],
  events: readonly DashboardV2Event[],
  keyOf: (event: DashboardV2Event) => string,
  pricingAvailable: boolean,
  totalTokens: number,
): DashboardV2BreakdownRow[] {
  return rows.map((row) => {
    const related = events.filter(
      (event) => (keyOf(event) || "unknown") === row.key,
    );
    const cost = pricingAvailable
      ? estimateUsageCost(
          related.map(({ context: _context, ...event }) => event),
        )
      : null;
    return {
      ...row,
      share: totalTokens === 0 ? 0 : (row.tokens / totalTokens) * 100,
      estimatedCostUsd: cost ? cost.knownUsd + cost.estimatedUsd : null,
      estimatedCostIsPartial: cost ? cost.unknownEvents > 0 : false,
    };
  });
}

function contextFor(
  events: readonly DashboardV2Event[],
): DashboardV2ContextCounts {
  return events.reduce(
    (counts, event) => {
      counts.textResponses += event.context.textResponses;
      counts.toolCalls += event.context.toolCalls;
      counts.skillCalls += event.context.skillCalls;
      counts.toolOutputCalls += event.context.toolOutputCalls;
      return counts;
    },
    { ...emptyContext() },
  );
}

function filterV2Events(
  events: readonly DashboardV2Event[],
  fromDate: Date,
  toDate: Date,
): DashboardV2Event[] {
  return events.filter((event) => {
    const timestamp = new Date(event.timestamp);
    return (
      !Number.isNaN(timestamp.getTime()) &&
      timestamp >= fromDate &&
      timestamp <= toDate
    );
  });
}

function validDateTime(value: string | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

/**
 * Creates the Hero projection from the same browser-safe dashboard snapshot.
 * The monitoring input is already a public, aggregate-only contract; this
 * module never learns scanner paths, sources, commands, or raw findings.
 */
export function createDashboardV2HeroView(input: {
  readonly snapshot: DashboardV2Snapshot;
  readonly monitoring: MonitoringStatus | null;
  readonly activeInsightCount: number;
  readonly now?: Date;
}): DashboardV2HeroView {
  const now = input.now ?? new Date();
  const nowTime = now.getTime();
  const detectedTools = input.snapshot.tools.filter(
    (tool) => tool.detected,
  ).length;
  const liveSources = new Set(
    input.snapshot.events
      .filter((event) => {
        const timestamp = validDateTime(event.timestamp);
        return (
          timestamp != null &&
          nowTime - timestamp >= 0 &&
          nowTime - timestamp <= liveWindowMs
        );
      })
      .map((event) => event.source),
  );
  const liveTools = input.snapshot.tools.filter(
    (tool) =>
      tool.detected && liveSources.has(tool.id as DashboardV2Event["source"]),
  ).length;
  const heartbeatAt = validDateTime(input.monitoring?.heartbeatAt);
  const heartbeatFresh =
    input.monitoring?.running === true &&
    heartbeatAt != null &&
    nowTime - heartbeatAt >= 0 &&
    nowTime - heartbeatAt <= heartbeatWindowMs;
  const hasFailure =
    input.monitoring?.collectors.some(
      (collector) =>
        collector.state === "failed" || collector.state === "degraded",
    ) ?? false;
  const health =
    input.monitoring == null
      ? "unavailable"
      : !input.monitoring.running
        ? "available"
        : !heartbeatFresh || hasFailure
          ? "degraded"
          : "listening";
  const monitoring = {
    health,
    isLive: health === "listening",
    liveTools,
    detectedTools,
    pendingCount:
      Math.max(0, input.activeInsightCount) +
      (input.monitoring?.pendingCount ?? 0),
  } as const;
  const allTime = createDashboardV2View(input.snapshot, "all");
  const topTool = allTime.tools[0];
  const cost = input.snapshot.pricingAvailable
    ? estimateUsageCost(
        input.snapshot.events.map(({ context: _context, ...event }) => event),
      )
    : null;
  const insights: DashboardV2Insight[] = [];
  if (allTime.totals.events > 0) {
    insights.push({
      id: "usage",
      kind: "usage",
      toolName: topTool?.name,
      tokens: allTime.totals.totalTokens,
    });
  }
  const inputTokens =
    allTime.totals.inputTokens +
    allTime.totals.cachedInputTokens +
    allTime.totals.cacheCreationInputTokens;
  if (inputTokens > 0 && allTime.totals.cachedInputTokens > 0) {
    insights.push({
      id: "cache",
      kind: "cache",
      cacheRate: (allTime.totals.cachedInputTokens / inputTokens) * 100,
    });
  }
  if (cost && cost.unknownEvents === 0) {
    insights.push({
      id: "cost",
      kind: "cost",
      estimatedCostUsd: cost.knownUsd + cost.estimatedUsd,
    });
  }
  if (input.monitoring?.security) {
    const riskCount =
      input.monitoring.security.suspiciousCount +
      input.monitoring.security.dangerousCount;
    insights.push({ id: "security", kind: "security", riskCount });
  }
  insights.push({ id: "monitoring", kind: "monitoring" });
  if (insights.length === 1 && insights[0]?.kind === "monitoring") {
    insights.unshift({ id: "empty", kind: "empty" });
  }
  return { insights, monitoring };
}

function selectedSessions(
  snapshot: DashboardV2Snapshot,
  period: UsagePeriod,
  from?: string,
  to?: string,
): number | null {
  if (!snapshot.sessions.available) return null;
  const range = resolveUsageRange(period, from, to);
  if (!range.valid || !range.fromDate || !range.toDate) return null;
  return snapshot.sessions.records.filter((session) => {
    const startedAt = new Date(session.startedAt);
    return (
      !Number.isNaN(startedAt.getTime()) &&
      startedAt >= range.fromDate! &&
      startedAt <= range.toDate!
    );
  }).length;
}

/**
 * The only period transformation used by Dashboard V2. All panels receive
 * this same projection, so it is impossible for a card and its related chart
 * to silently use different date ranges.
 */
export function createDashboardV2View(
  snapshot: DashboardV2Snapshot,
  period: UsagePeriod,
  from?: string,
  to?: string,
): DashboardV2View {
  const range = resolveUsageRange(period, from, to);
  const events =
    range.valid && range.fromDate && range.toDate
      ? filterV2Events(snapshot.events, range.fromDate, range.toDate)
      : [];
  const totals = totalsFor(events);
  const cost = snapshot.pricingAvailable
    ? estimateUsageCost(events.map(({ context: _context, ...event }) => event))
    : null;
  const bySource = ranked(events, (event) => event.source);
  const tools = snapshot.tools
    .map((tool) => {
      const usage = bySource.find((row) => row.key === tool.id);
      return {
        ...tool,
        tokens: usage?.tokens ?? 0,
        events: usage?.events ?? 0,
      };
    })
    .filter((tool) => tool.detected || tool.events > 0)
    .sort(
      (left, right) =>
        right.tokens - left.tokens || left.name.localeCompare(right.name),
    );
  // A known-but-currently-empty source is intentionally not promoted into a
  // tool card. This avoids presenting catalog availability as activity.
  const activeTools = tools.filter((tool) => tool.events > 0).length;
  const trend = daily(events);
  const models = enrichRows(
    ranked(events, (event) => event.model).slice(0, 8),
    events,
    (event) => event.model,
    snapshot.pricingAvailable,
    totals.totalTokens,
  );
  const projects = enrichRows(
    ranked(events, (event) => event.project).slice(0, 8),
    events,
    (event) => event.project,
    snapshot.pricingAvailable,
    totals.totalTokens,
  );
  const calendar = calendarFor(trend, range);

  return {
    period,
    from: range.from,
    to: range.to,
    hasData: events.length > 0,
    totals,
    estimatedCostUsd: cost ? cost.knownUsd + cost.estimatedUsd : null,
    estimatedCostIsPartial: cost ? cost.unknownEvents > 0 : false,
    sessions: selectedSessions(snapshot, period, from, to),
    skills: snapshot.skills.available ? snapshot.skills.count : null,
    activeTools,
    tools,
    trend,
    models,
    projects,
    calendar: calendar.points,
    calendarSummary: calendar.summary,
    context: contextFor(events),
  };
}
