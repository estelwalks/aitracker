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
  DashboardV2ContextAvailability,
  DashboardV2Event,
  DashboardV2Snapshot,
  DashboardV2TrendPoint,
  DashboardV2View,
} from "../contracts.ts";
import type { MonitoringStatus } from "../../monitoring/index.ts";

const liveWindowMs = 15 * 60 * 1000;
const heartbeatWindowMs = 20 * 60 * 1000;
/** Avoid presenting a one-event fluctuation as a meaningful period comparison. */
const minimumComparableEvents = 2;

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

const emptyContextAvailability = (): DashboardV2ContextAvailability => ({
  textResponses: false,
  toolCalls: false,
  skillCalls: false,
  toolOutputCalls: false,
  reasoningTokens: false,
  systemPromptTokens: false,
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
      previousTokens: null,
      deltaPercent: null,
      sessions: null,
    }));
}

function dateKey(timestamp: string): string | null {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localDateKey(date: Date): string {
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

function completeDailyRange(
  observed: readonly DashboardV2TrendPoint[],
  range: ReturnType<typeof resolveUsageRange>,
): DashboardV2TrendPoint[] {
  if (!range.valid || !range.fromDate || !range.toDate) return [];
  const byDate = new Map(observed.map((point) => [point.date, point]));
  const firstObserved = observed[0]?.date;
  const start =
    range.from === "1970-01-01" && firstObserved
      ? new Date(`${firstObserved}T00:00:00`)
      : range.from === "1970-01-01"
        ? range.toDate
        : range.fromDate;
  const points: DashboardV2TrendPoint[] = [];
  for (
    let cursor = new Date(start);
    cursor <= range.toDate;
    cursor = addLocalDays(cursor, 1)
  ) {
    const date = localDateKey(cursor);
    points.push(byDate.get(date) ?? { date, tokens: 0, events: 0 });
  }
  return points;
}

function addLocalDays(date: Date, amount: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function calendarFor(
  trend: readonly DashboardV2TrendPoint[],
  toDate: Date | null,
): { points: DashboardV2CalendarPoint[]; summary: DashboardV2CalendarSummary } {
  if (toDate == null || Number.isNaN(toDate.getTime()))
    return {
      points: [],
      summary: {
        days: 0,
        activeDays: 0,
        longestStreak: 0,
        totalTokens: 0,
      },
    };
  const observedByDate = new Map(trend.map((point) => [point.date, point]));
  const start = addLocalDays(toDate, -364);
  const points: DashboardV2CalendarPoint[] = [];
  for (
    let cursor = new Date(start);
    cursor <= toDate;
    cursor = addLocalDays(cursor, 1)
  ) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    const observed = observedByDate.get(key);
    points.push({
      date: key,
      tokens: observed?.tokens ?? 0,
      events: observed?.events ?? 0,
      active: (observed?.events ?? 0) > 0,
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
      totalTokens: points.reduce((sum, point) => sum + point.tokens, 0),
    },
  };
}

function enrichRows(
  rows: readonly DashboardV2BreakdownRow[],
  events: readonly DashboardV2Event[],
  previousEvents: readonly DashboardV2Event[],
  keyOf: (event: DashboardV2Event) => string,
  pricingAvailable: boolean,
  totalTokens: number,
  projectSessions: ReadonlyMap<string, number> | null,
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
    const previous = previousEvents.filter(
      (event) => (keyOf(event) || "unknown") === row.key,
    );
    const previousTotals = totalsFor(previous);
    const comparable =
      related.length >= minimumComparableEvents &&
      previous.length >= minimumComparableEvents &&
      previousTotals.totalTokens > 0;
    return {
      ...row,
      share: totalTokens === 0 ? 0 : (row.tokens / totalTokens) * 100,
      estimatedCostUsd: cost ? cost.knownUsd + cost.estimatedUsd : null,
      estimatedCostIsPartial: cost ? cost.unknownEvents > 0 : false,
      previousTokens: comparable ? previousTotals.totalTokens : null,
      deltaPercent: comparable
        ? ((row.tokens - previousTotals.totalTokens) /
            previousTotals.totalTokens) *
          100
        : null,
      sessions: projectSessions?.get(row.key) ?? null,
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

function contextAvailabilityFor(
  events: readonly DashboardV2Event[],
): DashboardV2ContextAvailability {
  return events.reduce(
    (availability, event) => ({
      textResponses: availability.textResponses || event.evidence.textResponses,
      toolCalls: availability.toolCalls || event.evidence.toolCalls,
      skillCalls: availability.skillCalls || event.evidence.skillCalls,
      toolOutputCalls:
        availability.toolOutputCalls || event.evidence.toolOutputCalls,
      reasoningTokens:
        availability.reasoningTokens || event.evidence.reasoningTokens,
      systemPromptTokens:
        availability.systemPromptTokens || event.evidence.systemPromptTokens,
    }),
    emptyContextAvailability(),
  );
}

function topWithRest(
  rows: readonly DashboardV2BreakdownRow[],
  limit: number,
): DashboardV2BreakdownRow[] {
  if (rows.length <= limit) return [...rows];
  const head = rows.slice(0, Math.max(1, limit - 1));
  const tail = rows.slice(head.length);
  const nullableSum = (values: readonly (number | null)[]) =>
    values.some((value) => value == null)
      ? null
      : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  return [
    ...head,
    {
      key: "other",
      tokens: tail.reduce((sum, row) => sum + row.tokens, 0),
      events: tail.reduce((sum, row) => sum + row.events, 0),
      share: tail.reduce((sum, row) => sum + row.share, 0),
      estimatedCostUsd: nullableSum(tail.map((row) => row.estimatedCostUsd)),
      estimatedCostIsPartial: tail.some(
        (row) => row.estimatedCostIsPartial || row.estimatedCostUsd == null,
      ),
      previousTokens: null,
      deltaPercent: null,
      sessions: nullableSum(tail.map((row) => row.sessions)),
    },
  ];
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
  return snapshot.sessions.bySourceDay.reduce((total, session) => {
    const startedAt = new Date(`${session.date}T00:00:00`);
    return startedAt >= range.fromDate! && startedAt <= range.toDate!
      ? total + session.count
      : total;
  }, 0);
}

function previousWindow(
  period: UsagePeriod,
  range: ReturnType<typeof resolveUsageRange>,
): { fromDate: Date; toDate: Date } | null {
  // An all-time window has no coherent predecessor. For all other concrete
  // date ranges (including custom), the immediately preceding equal span is
  // unambiguous and is more useful than a made-up calendar comparison.
  if (period === "all" || !range.valid || !range.fromDate || !range.toDate) {
    return null;
  }
  const previousTo = new Date(range.fromDate.getTime() - 1);
  const span = range.toDate.getTime() - range.fromDate.getTime();
  return {
    fromDate: new Date(previousTo.getTime() - span),
    toDate: previousTo,
  };
}

function observedCacheRate(totals: LocalUsageTotals): number | null {
  const input =
    totals.inputTokens +
    totals.cachedInputTokens +
    totals.cacheCreationInputTokens;
  return input === 0 ? null : (totals.cachedInputTokens / input) * 100;
}

function comparableDelta(
  current: number,
  previous: number,
  currentEvents: number,
  previousEvents: number,
): { previous: number | null; deltaPercent: number | null } {
  if (
    currentEvents < minimumComparableEvents ||
    previousEvents < minimumComparableEvents ||
    previous <= 0
  ) {
    return { previous: null, deltaPercent: null };
  }
  return {
    previous,
    deltaPercent: ((current - previous) / previous) * 100,
  };
}

function projectSessionCounts(
  snapshot: DashboardV2Snapshot,
  fromDate: Date | null,
  toDate: Date | null,
): ReadonlyMap<string, number> | null {
  if (!snapshot.sessions.available || !fromDate || !toDate) return null;
  const counts = new Map<string, number>();
  for (const row of snapshot.sessions.byProjectDay) {
    const date = new Date(`${row.date}T00:00:00`);
    if (date < fromDate || date > toDate) continue;
    counts.set(row.project, (counts.get(row.project) ?? 0) + row.count);
  }
  return counts;
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
  const previousRange = previousWindow(period, range);
  const previousEvents = previousRange
    ? filterV2Events(
        snapshot.events,
        previousRange.fromDate,
        previousRange.toDate,
      )
    : [];
  const previousTotals = totalsFor(previousEvents);
  const cost = snapshot.pricingAvailable
    ? estimateUsageCost(events.map(({ context: _context, ...event }) => event))
    : null;
  const previousCost = snapshot.pricingAvailable
    ? estimateUsageCost(
        previousEvents.map(({ context: _context, ...event }) => event),
      )
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
  const observedTrend = daily(events);
  const trend = completeDailyRange(observedTrend, range);
  const currentProjectSessions = projectSessionCounts(
    snapshot,
    range.fromDate,
    range.toDate,
  );
  const allModelRows = ranked(events, (event) => event.model);
  const allProjectRows = ranked(events, (event) => event.project);
  const models = enrichRows(
    allModelRows.slice(0, 8),
    events,
    previousEvents,
    (event) => event.model,
    snapshot.pricingAvailable,
    totals.totalTokens,
    null,
  );
  const projects = topWithRest(
    enrichRows(
      allProjectRows,
      events,
      previousEvents,
      (event) => event.project,
      snapshot.pricingAvailable,
      totals.totalTokens,
      currentProjectSessions,
    ),
    11,
  );
  const generatedAt = new Date(snapshot.generatedAt);
  if (!Number.isNaN(generatedAt.getTime()))
    generatedAt.setHours(23, 59, 59, 999);
  const calendarTo =
    range.toDate == null
      ? null
      : Number.isNaN(generatedAt.getTime())
        ? range.toDate
        : new Date(Math.min(range.toDate.getTime(), generatedAt.getTime()));
  const calendarFrom = calendarTo ? addLocalDays(calendarTo, -364) : null;
  const calendarEvents =
    calendarFrom && calendarTo
      ? filterV2Events(snapshot.events, calendarFrom, calendarTo)
      : [];
  const calendar = calendarFor(daily(calendarEvents), calendarTo);
  const tokenComparison = comparableDelta(
    totals.totalTokens,
    previousTotals.totalTokens,
    totals.events,
    previousTotals.events,
  );
  const eventComparison = comparableDelta(
    totals.events,
    previousTotals.events,
    totals.events,
    previousTotals.events,
  );
  const currentCacheRate = observedCacheRate(totals);
  const previousCacheRate = observedCacheRate(previousTotals);
  const cacheComparable =
    currentCacheRate != null &&
    previousCacheRate != null &&
    totals.events >= minimumComparableEvents &&
    previousTotals.events >= minimumComparableEvents;
  const costComparable =
    cost != null &&
    previousCost != null &&
    cost.unknownEvents === 0 &&
    previousCost.unknownEvents === 0;
  const costComparison = costComparable
    ? comparableDelta(
        cost.knownUsd + cost.estimatedUsd,
        previousCost.knownUsd + previousCost.estimatedUsd,
        totals.events,
        previousTotals.events,
      )
    : { previous: null, deltaPercent: null };

  return {
    period,
    from: range.from,
    to: range.to,
    hasData: events.length > 0,
    totals,
    estimatedCostUsd: cost ? cost.knownUsd + cost.estimatedUsd : null,
    estimatedCostIsPartial: cost ? cost.unknownEvents > 0 : false,
    cacheRate: currentCacheRate,
    comparison: {
      tokens: tokenComparison,
      events: eventComparison,
      cost: costComparison,
      cacheRate: {
        previous: cacheComparable ? previousCacheRate : null,
        deltaPercent: null,
        deltaPoints: cacheComparable
          ? currentCacheRate - previousCacheRate
          : null,
      },
    },
    sessions: selectedSessions(snapshot, period, from, to),
    skills: snapshot.skills.available ? snapshot.skills.count : null,
    activeTools,
    usageSupportedToolCount: snapshot.tools.filter(
      (tool) => tool.usageSupport !== "unsupported",
    ).length,
    modelCount: allModelRows.length,
    projectCount: allProjectRows.length,
    outputAvailability: snapshot.outputAvailability,
    tools,
    trend,
    models,
    projects,
    calendar: calendar.points,
    calendarSummary: calendar.summary,
    context: contextFor(events),
    contextAvailability: contextAvailabilityFor(events),
  };
}
