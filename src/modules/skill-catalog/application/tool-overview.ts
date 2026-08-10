import {
  resolveUsageRange,
  type UsagePeriod,
} from "../../../lib/local-usage/presentation.ts";
import type {
  DashboardV2ContextCounts,
  DashboardV2Event,
  DashboardV2Snapshot,
} from "../../dashboard/contracts.ts";

export type ToolOverviewState =
  "active" | "detected" | "available" | "unavailable";

export interface ToolOverviewCard {
  readonly id: string;
  readonly name: string;
  readonly detected: boolean;
  readonly available: boolean;
  readonly active: boolean;
  /** Observed activity takes precedence over catalog availability. */
  readonly state: ToolOverviewState;
  readonly tokens: number;
  readonly events: number;
  /** Share of all observed tool tokens in the selected period. */
  readonly share: number;
  /** Null is an unavailable session source, never a synthetic zero. */
  readonly sessions: number | null;
  /** Null means the source did not expose a cacheable input denominator. */
  readonly cacheRate: number | null;
  readonly lastActiveAt: string | null;
  readonly skillUsage: ToolOverviewSkillUsage;
}

/** `observed: false` is intentionally different from an observed zero call count. */
export interface ToolOverviewSkillUsage {
  readonly observed: boolean;
  readonly calls: number;
}

export interface ToolOverviewTrendPoint {
  readonly date: string;
  readonly tokens: number;
}

export interface ToolOverviewBreakdownRow {
  readonly key: string;
  readonly tokens: number;
  readonly events: number;
  /** Source-scoped, server aggregated session count for project rows only. */
  readonly sessions: number | null;
}

export interface ToolOverviewContextRow {
  readonly key: keyof DashboardV2ContextCounts;
  readonly count: number;
}

/**
 * Public, local-scan-only tool overview. It deliberately aggregates already
 * sanitized dashboard events and does not use raw session content, paths,
 * prompts, commands, or heuristic token allocation.
 */
export interface ToolOverviewView {
  readonly period: UsagePeriod;
  readonly cards: readonly ToolOverviewCard[];
  readonly selected: ToolOverviewCard | null;
  readonly activeToolCount: number;
  readonly detectedToolCount: number;
  readonly availableToolCount: number;
  readonly totalTokens: number;
  readonly totalEvents: number;
  readonly sessions: number | null;
  readonly cacheRate: number | null;
  readonly trend: readonly ToolOverviewTrendPoint[];
  readonly models: readonly ToolOverviewBreakdownRow[];
  readonly projects: readonly ToolOverviewBreakdownRow[];
  readonly context: readonly ToolOverviewContextRow[];
  readonly skillUsage: ToolOverviewSkillUsage;
}

function inRange(
  events: readonly DashboardV2Event[],
  period: UsagePeriod,
  from?: string,
  to?: string,
): DashboardV2Event[] {
  const range = resolveUsageRange(period, from, to);
  if (!range.valid || !range.fromDate || !range.toDate) return [];
  return events.filter((event) => {
    const timestamp = new Date(event.timestamp);
    return (
      !Number.isNaN(timestamp.getTime()) &&
      timestamp >= range.fromDate! &&
      timestamp <= range.toDate!
    );
  });
}

function rank(
  events: readonly DashboardV2Event[],
  keyOf: (event: DashboardV2Event) => string,
  sessionsByKey?: ReadonlyMap<string, number> | null,
): ToolOverviewBreakdownRow[] {
  const rows = new Map<string, ToolOverviewBreakdownRow>();
  for (const event of events) {
    const key = keyOf(event) || "unknown";
    const current = rows.get(key) ?? { key, tokens: 0, events: 0 };
    rows.set(key, {
      key,
      tokens: current.tokens + event.totalTokens,
      events: current.events + 1,
      sessions: sessionsByKey?.get(key) ?? null,
    });
  }
  return [...rows.values()].sort(
    (left, right) =>
      right.tokens - left.tokens || left.key.localeCompare(right.key),
  );
}

function trend(events: readonly DashboardV2Event[]): ToolOverviewTrendPoint[] {
  const rows = new Map<string, number>();
  for (const event of events) {
    const date = event.timestamp.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) continue;
    rows.set(date, (rows.get(date) ?? 0) + event.totalTokens);
  }
  return [...rows.entries()]
    .map(([date, tokens]) => ({ date, tokens }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

function context(
  events: readonly DashboardV2Event[],
): ToolOverviewContextRow[] {
  const counts: Record<keyof DashboardV2ContextCounts, number> = {
    textResponses: 0,
    toolCalls: 0,
    skillCalls: 0,
    toolOutputCalls: 0,
  };
  for (const event of events) {
    counts.textResponses += event.context.textResponses;
    counts.toolCalls += event.context.toolCalls;
    counts.skillCalls += event.context.skillCalls;
    counts.toolOutputCalls += event.context.toolOutputCalls;
  }
  return (Object.keys(counts) as (keyof DashboardV2ContextCounts)[]).map(
    (key) => ({ key, count: counts[key] }),
  );
}

function skillUsage(
  events: readonly DashboardV2Event[],
): ToolOverviewSkillUsage {
  // V2 projects source logs into aggregate counts. A zero is therefore
  // observed evidence whenever an event exists; an empty event set is not.
  const observed = events.length > 0;
  return {
    observed,
    calls: events.reduce((total, event) => total + event.context.skillCalls, 0),
  };
}

function cacheRate(events: readonly DashboardV2Event[]): number | null {
  const input = events.reduce(
    (total, event) =>
      total +
      event.inputTokens +
      event.cachedInputTokens +
      event.cacheCreationInputTokens,
    0,
  );
  if (input === 0) return null;
  const cached = events.reduce(
    (total, event) => total + event.cachedInputTokens,
    0,
  );
  return (cached / input) * 100;
}

function dateWithinRange(
  date: string,
  period: UsagePeriod,
  from?: string,
  to?: string,
) {
  const range = resolveUsageRange(period, from, to);
  if (!range.valid || !range.fromDate || !range.toDate) return false;
  const value = new Date(`${date}T00:00:00`);
  return (
    !Number.isNaN(value.getTime()) &&
    value >= range.fromDate &&
    value <= range.toDate
  );
}

function sessionsForSource(
  snapshot: DashboardV2Snapshot,
  source: string,
  period: UsagePeriod,
  from?: string,
  to?: string,
): number | null {
  if (!snapshot.sessions.available) return null;
  return snapshot.sessions.bySourceDay.reduce(
    (total, row) =>
      row.source === source && dateWithinRange(row.date, period, from, to)
        ? total + row.count
        : total,
    0,
  );
}

function projectSessionsForSource(
  snapshot: DashboardV2Snapshot,
  source: string,
  period: UsagePeriod,
  from?: string,
  to?: string,
): ReadonlyMap<string, number> | null {
  if (!snapshot.sessions.available) return null;
  const sessions = new Map<string, number>();
  for (const row of snapshot.sessions.byProjectDay) {
    if (row.source !== source || !dateWithinRange(row.date, period, from, to))
      continue;
    sessions.set(row.project, (sessions.get(row.project) ?? 0) + row.count);
  }
  return sessions;
}

export function buildToolOverview(
  snapshot: DashboardV2Snapshot,
  selectedToolId: string | null,
  period: UsagePeriod,
  from?: string,
  to?: string,
): ToolOverviewView {
  const periodEvents = inRange(snapshot.events, period, from, to);
  const totalPeriodTokens = periodEvents.reduce(
    (total, event) => total + event.totalTokens,
    0,
  );
  const cards = snapshot.tools
    .map((tool) => {
      const events = periodEvents.filter((event) => event.source === tool.id);
      const lastActiveAt = events.reduce<string | null>(
        (latest, event) =>
          latest == null || event.timestamp > latest ? event.timestamp : latest,
        null,
      );
      const tokens = events.reduce(
        (total, event) => total + event.totalTokens,
        0,
      );
      const active = events.length > 0;
      const state: ToolOverviewState = active
        ? "active"
        : tool.detected
          ? "detected"
          : tool.available
            ? "available"
            : "unavailable";
      return {
        ...tool,
        active,
        state,
        tokens,
        events: events.length,
        share: totalPeriodTokens === 0 ? 0 : (tokens / totalPeriodTokens) * 100,
        sessions: sessionsForSource(snapshot, tool.id, period, from, to),
        cacheRate: cacheRate(events),
        lastActiveAt,
        skillUsage: skillUsage(events),
      };
    })
    .sort(
      (left, right) =>
        (right.state === "active"
          ? 3
          : right.state === "detected"
            ? 2
            : right.state === "available"
              ? 1
              : 0) -
          (left.state === "active"
            ? 3
            : left.state === "detected"
              ? 2
              : left.state === "available"
                ? 1
                : 0) ||
        right.tokens - left.tokens ||
        left.name.localeCompare(right.name),
    );
  const selected =
    cards.find((card) => card.id === selectedToolId) ?? cards[0] ?? null;
  const selectedEvents = selected
    ? periodEvents.filter((event) => event.source === selected.id)
    : [];

  const selectedProjectSessions = selected
    ? projectSessionsForSource(snapshot, selected.id, period, from, to)
    : null;

  return {
    period,
    cards,
    selected,
    activeToolCount: cards.filter((card) => card.active).length,
    detectedToolCount: cards.filter((card) => card.detected).length,
    availableToolCount: cards.filter((card) => card.available).length,
    totalTokens: selectedEvents.reduce(
      (total, event) => total + event.totalTokens,
      0,
    ),
    totalEvents: selectedEvents.length,
    sessions: selected
      ? sessionsForSource(snapshot, selected.id, period, from, to)
      : null,
    cacheRate: cacheRate(selectedEvents),
    trend: trend(selectedEvents),
    models: rank(selectedEvents, (event) => event.model),
    projects: rank(
      selectedEvents,
      (event) => event.project,
      selectedProjectSessions,
    ),
    context: context(selectedEvents),
    skillUsage: skillUsage(selectedEvents),
  };
}
