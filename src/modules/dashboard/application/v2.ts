import { estimateUsageCost } from "../../../lib/pricing/index.ts";
import {
  resolveUsageRange,
  type UsagePeriod,
} from "../../../lib/local-usage/presentation.ts";
import type { LocalUsageTotals } from "../../../lib/local-usage/types.ts";
import type {
  DashboardV2BreakdownRow,
  DashboardV2ContextCounts,
  DashboardV2Event,
  DashboardV2Snapshot,
  DashboardV2TrendPoint,
  DashboardV2View,
} from "../contracts.ts";

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
  return [...rows.values()].sort(
    (left, right) =>
      right.tokens - left.tokens || left.key.localeCompare(right.key),
  );
}

function daily(events: readonly DashboardV2Event[]): DashboardV2TrendPoint[] {
  const rows = new Map<
    string,
    { date: string; tokens: number; events: number }
  >();
  for (const event of events) {
    const date = event.timestamp.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) continue;
    const current = rows.get(date) ?? { date, tokens: 0, events: 0 };
    current.tokens += event.totalTokens;
    current.events += 1;
    rows.set(date, current);
  }
  return [...rows.values()].sort((left, right) =>
    left.date.localeCompare(right.date),
  );
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
  const models = ranked(events, (event) => event.model).slice(0, 8);
  const projects = ranked(events, (event) => event.project).slice(0, 8);

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
    calendar: trend,
    context: contextFor(events),
  };
}
