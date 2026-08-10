import {
  resolveUsageRange,
  type UsagePeriod,
} from "../../../lib/local-usage/presentation.ts";
import type {
  DashboardV2ContextCounts,
  DashboardV2Snapshot,
  DashboardUsageEvent,
} from "../../dashboard/contracts.ts";

export interface ToolOverviewCard {
  readonly id: string;
  readonly name: string;
  readonly detected: boolean;
  readonly available: boolean;
  readonly active: boolean;
  readonly tokens: number;
  readonly events: number;
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
  readonly totalTokens: number;
  readonly totalEvents: number;
  readonly trend: readonly ToolOverviewTrendPoint[];
  readonly models: readonly ToolOverviewBreakdownRow[];
  readonly projects: readonly ToolOverviewBreakdownRow[];
  readonly context: readonly ToolOverviewContextRow[];
  readonly skillUsage: ToolOverviewSkillUsage;
}

function inRange(
  events: readonly DashboardUsageEvent[],
  period: UsagePeriod,
  from?: string,
  to?: string,
): DashboardUsageEvent[] {
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
  events: readonly DashboardUsageEvent[],
  keyOf: (event: DashboardUsageEvent) => string,
): ToolOverviewBreakdownRow[] {
  const rows = new Map<string, ToolOverviewBreakdownRow>();
  for (const event of events) {
    const key = keyOf(event) || "unknown";
    const current = rows.get(key) ?? { key, tokens: 0, events: 0 };
    rows.set(key, {
      key,
      tokens: current.tokens + event.totalTokens,
      events: current.events + 1,
    });
  }
  return [...rows.values()].sort(
    (left, right) =>
      right.tokens - left.tokens || left.key.localeCompare(right.key),
  );
}

function trend(
  events: readonly DashboardUsageEvent[],
): ToolOverviewTrendPoint[] {
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
  events: readonly DashboardUsageEvent[],
): ToolOverviewContextRow[] {
  const counts: Record<keyof DashboardV2ContextCounts, number> = {
    textResponses: 0,
    toolCalls: 0,
    skillCalls: 0,
    toolOutputCalls: 0,
  };
  for (const event of events) {
    counts.textResponses += event.context?.textResponse ? 1 : 0;
    counts.toolCalls +=
      event.context?.tools?.reduce((total, tool) => total + tool.calls, 0) ?? 0;
    counts.skillCalls +=
      event.context?.skills?.reduce((total, skill) => total + skill.calls, 0) ??
      0;
    counts.toolOutputCalls += event.context?.toolOutputs?.calls ?? 0;
  }
  return (Object.keys(counts) as (keyof DashboardV2ContextCounts)[]).map(
    (key) => ({ key, count: counts[key] }),
  );
}

function skillUsage(
  events: readonly DashboardUsageEvent[],
): ToolOverviewSkillUsage {
  const observed = events.some((event) => event.context?.skills !== undefined);
  return {
    observed,
    calls: events.reduce(
      (total, event) =>
        total +
        (event.context?.skills?.reduce((sum, skill) => sum + skill.calls, 0) ??
          0),
      0,
    ),
  };
}

export function buildToolOverview(
  snapshot: Pick<DashboardV2Snapshot, "tools"> & {
    readonly events: readonly DashboardUsageEvent[];
  },
  selectedToolId: string | null,
  period: UsagePeriod,
  from?: string,
  to?: string,
): ToolOverviewView {
  const periodEvents = inRange(snapshot.events, period, from, to);
  const cards = snapshot.tools
    .map((tool) => {
      const events = periodEvents.filter((event) => event.source === tool.id);
      const lastActiveAt = events.reduce<string | null>(
        (latest, event) =>
          latest == null || event.timestamp > latest ? event.timestamp : latest,
        null,
      );
      return {
        ...tool,
        active: events.length > 0,
        tokens: events.reduce((total, event) => total + event.totalTokens, 0),
        events: events.length,
        lastActiveAt,
        skillUsage: skillUsage(events),
      };
    })
    .filter((tool) => tool.detected || tool.events > 0)
    .sort(
      (left, right) =>
        Number(right.active) - Number(left.active) ||
        right.tokens - left.tokens ||
        left.name.localeCompare(right.name),
    );
  const selected =
    cards.find((card) => card.id === selectedToolId) ?? cards[0] ?? null;
  const selectedEvents = selected
    ? periodEvents.filter((event) => event.source === selected.id)
    : [];

  return {
    period,
    cards,
    selected,
    totalTokens: selectedEvents.reduce(
      (total, event) => total + event.totalTokens,
      0,
    ),
    totalEvents: selectedEvents.length,
    trend: trend(selectedEvents),
    models: rank(selectedEvents, (event) => event.model),
    projects: rank(selectedEvents, (event) => event.project),
    context: context(selectedEvents),
    skillUsage: skillUsage(selectedEvents),
  };
}
