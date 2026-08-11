import {
  resolveUsageRange,
  type UsagePeriod,
} from "../../../lib/local-usage/presentation.ts";
import { estimateUsageCost } from "../../../lib/pricing/index.ts";
import { PUBLIC_TOOL_MANIFEST } from "../../../lib/tool-registry/public-manifest.generated.ts";
import type { LocalUsageToolCategory } from "../../../lib/local-usage/types.ts";
import type {
  DashboardV2ContextCounts,
  DashboardV2Event,
  DashboardV2Snapshot,
} from "../../dashboard/contracts.ts";

export type ToolOverviewState =
  "active" | "detected" | "available" | "unavailable";

const registryNameById = new Map(
  PUBLIC_TOOL_MANIFEST.tools.map((tool) => [tool.id, tool.name]),
);

/** The aggregate can be mixed only when the source itself has mixed records. */
export type ToolOverviewMeasurement =
  "observed" | "estimated" | "mixed" | "unavailable";

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
  /** Null means the session scanner is unavailable. */
  readonly subagentCalls: number | null;
  /** Null means the source did not expose a cacheable input denominator. */
  readonly cacheRate: number | null;
  /** Null is no event evidence; zero is an observed range with no responses. */
  readonly messages: number | null;
  readonly lastActiveAt: string | null;
  readonly skillUsage: ToolOverviewSkillUsage;
  /** Estimate-only sources expose model totals but no context attribution. */
  readonly measurement: ToolOverviewMeasurement;
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
  /** Null means pricing is unavailable; a partial value carries known pricing only. */
  readonly estimatedCostUsd: number | null;
  readonly estimatedCostIsPartial: boolean;
}

export interface ToolOverviewContextRow {
  readonly key: keyof DashboardV2ContextCounts;
  readonly count: number | null;
  readonly available: boolean;
}

/** A named, privacy-safe tool-call aggregate from local usage logs. */
export interface ToolOverviewToolCallDetail {
  readonly name: string;
  readonly category: LocalUsageToolCategory;
  readonly calls: number;
  /**
   * Token attribution across calls in the same observed usage event. This is
   * not provider-supplied per-tool billing and is labelled as such in the UI.
   */
  readonly attributedTokens: number;
}

export interface ToolOverviewTokenComposition {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly outputTokens: number;
  readonly reasoningOutputTokens: number;
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
  readonly naturalDays: number;
  readonly sessions: number | null;
  readonly cacheRate: number | null;
  readonly trend: readonly ToolOverviewTrendPoint[];
  readonly models: readonly ToolOverviewBreakdownRow[];
  readonly projects: readonly ToolOverviewBreakdownRow[];
  readonly context: readonly ToolOverviewContextRow[];
  /** Detailed, sanitized tool-call evidence for the selected source/range. */
  readonly toolCallDetails: readonly ToolOverviewToolCallDetail[];
  /** False only when the source did not expose tool-call context at all. */
  readonly toolCallDetailsAvailable: boolean;
  readonly tokenComposition: ToolOverviewTokenComposition;
  readonly reasoningAvailable: boolean;
  readonly systemPromptAvailable: boolean;
  readonly skillUsage: ToolOverviewSkillUsage;
  /** Whether the selected source has any safely attributable context field. */
  readonly hasContextBreakdown: boolean;
  /** Directly observed, estimated-only, mixed, or no usage event in range. */
  readonly measurement: ToolOverviewMeasurement;
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
  pricingAvailable: boolean,
  sessionsByKey?: ReadonlyMap<string, number> | null,
): ToolOverviewBreakdownRow[] {
  const rows = new Map<string, ToolOverviewBreakdownRow>();
  for (const event of events) {
    const key = keyOf(event) || "unknown";
    const current = rows.get(key) ?? {
      key,
      tokens: 0,
      events: 0,
      sessions: sessionsByKey?.get(key) ?? null,
      estimatedCostUsd: null,
      estimatedCostIsPartial: false,
    };
    rows.set(key, {
      key,
      tokens: current.tokens + event.totalTokens,
      events: current.events + 1,
      sessions: sessionsByKey?.get(key) ?? null,
      estimatedCostUsd: null,
      estimatedCostIsPartial: false,
    });
  }
  return [...rows.values()]
    .map((row) => {
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
        estimatedCostUsd: cost ? cost.knownUsd + cost.estimatedUsd : null,
        estimatedCostIsPartial: cost ? cost.unknownEvents > 0 : false,
      };
    })
    .sort(
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

function completeTrend(
  events: readonly DashboardV2Event[],
  period: UsagePeriod,
  from?: string,
  to?: string,
): ToolOverviewTrendPoint[] {
  const observed = trend(events);
  const byDate = new Map(observed.map((point) => [point.date, point]));
  const range = resolveUsageRange(period, from, to);
  if (!range.valid || !range.fromDate || !range.toDate) return [];
  const start =
    period === "all"
      ? observed[0]
        ? new Date(`${observed[0].date}T00:00:00`)
        : range.toDate
      : range.fromDate;
  const points: ToolOverviewTrendPoint[] = [];
  for (
    let cursor = new Date(start);
    cursor <= range.toDate;
    cursor.setDate(cursor.getDate() + 1)
  ) {
    const date = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    points.push(byDate.get(date) ?? { date, tokens: 0 });
  }
  return points;
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
  const evidence: Record<keyof DashboardV2ContextCounts, boolean> = {
    textResponses: false,
    toolCalls: false,
    skillCalls: false,
    toolOutputCalls: false,
  };
  for (const event of events) {
    counts.textResponses += event.context.textResponses;
    counts.toolCalls += event.context.toolCalls;
    counts.skillCalls += event.context.skillCalls;
    counts.toolOutputCalls += event.context.toolOutputCalls;
    evidence.textResponses ||= event.evidence.textResponses;
    evidence.toolCalls ||= event.evidence.toolCalls;
    evidence.skillCalls ||= event.evidence.skillCalls;
    evidence.toolOutputCalls ||= event.evidence.toolOutputCalls;
  }
  return (Object.keys(counts) as (keyof DashboardV2ContextCounts)[]).map(
    (key) => ({
      key,
      count: evidence[key] ? counts[key] : null,
      available: evidence[key],
    }),
  );
}

function uniqueEventTools(event: DashboardV2Event) {
  const rows = new Map<
    string,
    { name: string; category: LocalUsageToolCategory; calls: number }
  >();
  for (const tool of event.context.tools ?? []) {
    if (tool.calls <= 0 || tool.name.length === 0) continue;
    const key = `${tool.category}\u0000${tool.name}`;
    const current = rows.get(key);
    if (current == null) rows.set(key, { ...tool });
    else current.calls += tool.calls;
  }
  return [...rows.values()].sort(
    (left, right) =>
      left.name.localeCompare(right.name) ||
      left.category.localeCompare(right.category),
  );
}

/** Integer, call-weighted allocation that preserves each event's total exactly. */
function allocateTokens(total: number, calls: readonly number[]): number[] {
  const sum = calls.reduce((value, count) => value + count, 0);
  if (sum <= 0) return calls.map(() => 0);
  const raw = calls.map((count) => (total * count) / sum);
  const allocated = raw.map((value) => Math.floor(value));
  let remaining =
    total - allocated.reduce((value, tokens) => value + tokens, 0);
  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort(
      (left, right) =>
        right.fraction - left.fraction || left.index - right.index,
    );
  for (const item of order) {
    if (remaining <= 0) break;
    allocated[item.index]! += 1;
    remaining -= 1;
  }
  return allocated;
}

function toolCallDetails(events: readonly DashboardV2Event[]): {
  available: boolean;
  rows: readonly ToolOverviewToolCallDetail[];
} {
  const rows = new Map<
    string,
    {
      name: string;
      category: LocalUsageToolCategory;
      calls: number;
      attributedTokens: number;
    }
  >();
  let available = false;
  for (const event of events) {
    if (!event.evidence.toolCalls) continue;
    available = true;
    const tools = uniqueEventTools(event);
    const allocations = allocateTokens(
      event.totalTokens,
      tools.map((tool) => tool.calls),
    );
    for (const [index, tool] of tools.entries()) {
      const key = `${tool.category}\u0000${tool.name}`;
      const current = rows.get(key) ?? {
        name: tool.name,
        category: tool.category,
        calls: 0,
        attributedTokens: 0,
      };
      current.calls += tool.calls;
      current.attributedTokens += allocations[index] ?? 0;
      rows.set(key, current);
    }
  }
  return {
    available,
    rows: [...rows.values()].sort(
      (left, right) =>
        right.attributedTokens - left.attributedTokens ||
        left.name.localeCompare(right.name),
    ),
  };
}

function tokenComposition(
  events: readonly DashboardV2Event[],
): ToolOverviewTokenComposition {
  return events.reduce<ToolOverviewTokenComposition>(
    (total, event) => ({
      inputTokens: total.inputTokens + event.inputTokens,
      cachedInputTokens: total.cachedInputTokens + event.cachedInputTokens,
      cacheCreationInputTokens:
        total.cacheCreationInputTokens + event.cacheCreationInputTokens,
      // output includes reasoning in current provider schemas; expose the
      // mutually-exclusive assistant-response slice to avoid double counting.
      outputTokens:
        total.outputTokens +
        Math.max(0, event.outputTokens - event.reasoningOutputTokens),
      reasoningOutputTokens:
        total.reasoningOutputTokens + event.reasoningOutputTokens,
    }),
    {
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    },
  );
}

function skillUsage(
  events: readonly DashboardV2Event[],
): ToolOverviewSkillUsage {
  // V2 projects source logs into aggregate counts. A zero is therefore
  // observed evidence whenever an event exists; an empty event set is not.
  const observed = events.some((event) => event.evidence.skillCalls);
  return {
    observed,
    calls: events.reduce((total, event) => total + event.context.skillCalls, 0),
  };
}

function measurementFor(
  events: readonly DashboardV2Event[],
): ToolOverviewMeasurement {
  if (events.length === 0) return "unavailable";
  const observed = events.some((event) => event.measurement !== "estimated");
  const estimated = events.some((event) => event.measurement === "estimated");
  if (observed && estimated) return "mixed";
  return estimated ? "estimated" : "observed";
}

function hasContextBreakdown(events: readonly DashboardV2Event[]): boolean {
  return events.some((event) =>
    Object.values(event.evidence).some((available) => available),
  );
}

function cacheRate(events: readonly DashboardV2Event[]): number | null {
  // Transcript-size estimates cannot establish cache usage. Do not turn an
  // omitted cache field into a misleading observed 0%.
  if (
    events.length === 0 ||
    events.every((event) => event.measurement === "estimated")
  ) {
    return null;
  }
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

function subagentsForSource(
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
        ? total + row.subagentCalls
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
  const sourceTools = new Map(snapshot.tools.map((tool) => [tool.id, tool]));
  // Only show a tool when local installation/data evidence exists. This keeps
  // the overview focused while allowing every actually used/detected tool
  // (rather than a fixed pair) to select its own supported detail dimensions.
  const cardToolIds = snapshot.tools
    .filter(
      (tool) =>
        tool.detected ||
        tool.available ||
        periodEvents.some((event) => event.source === tool.id),
    )
    .map((tool) => tool.id);
  const cards = cardToolIds.map((toolId) => {
    const scannedTool = sourceTools.get(toolId);
    const tool = {
      id: toolId,
      // The dashboard snapshot is built server-side from the public tool
      // manifest, whose name is the registry definition's `display.name`.
      // The generated manifest is a browser-safe projection of `display.name`.
      // It remains the fallback while scanner data is unavailable.
      name: scannedTool?.name ?? registryNameById.get(toolId) ?? toolId,
      available: scannedTool?.available ?? false,
      detected: scannedTool?.detected ?? false,
    };
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
      subagentCalls: subagentsForSource(snapshot, tool.id, period, from, to),
      cacheRate: cacheRate(events),
      messages: !events.some((event) => event.evidence.textResponses)
        ? null
        : events.reduce(
            (total, event) => total + event.context.textResponses,
            0,
          ),
      lastActiveAt,
      skillUsage: skillUsage(events),
      measurement: measurementFor(events),
    };
  });
  // A persisted/manual selection wins. On first load, prefer actual activity
  // over installation order so the overview opens on meaningful evidence.
  const selected =
    cards.find((card) => card.id === selectedToolId) ??
    cards.find((card) => card.active) ??
    cards[0] ??
    null;
  const selectedEvents = selected
    ? periodEvents.filter((event) => event.source === selected.id)
    : [];

  const selectedProjectSessions = selected
    ? projectSessionsForSource(snapshot, selected.id, period, from, to)
    : null;
  const detailedToolCalls = toolCallDetails(selectedEvents);

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
    naturalDays: completeTrend(selectedEvents, period, from, to).length,
    sessions: selected
      ? sessionsForSource(snapshot, selected.id, period, from, to)
      : null,
    cacheRate: cacheRate(selectedEvents),
    trend: completeTrend(selectedEvents, period, from, to),
    models: rank(
      selectedEvents,
      (event) => event.model,
      snapshot.pricingAvailable,
    ),
    projects: rank(
      selectedEvents,
      (event) => event.project,
      snapshot.pricingAvailable,
      selectedProjectSessions,
    ),
    context: context(selectedEvents),
    toolCallDetails: detailedToolCalls.rows,
    toolCallDetailsAvailable: detailedToolCalls.available,
    tokenComposition: tokenComposition(selectedEvents),
    reasoningAvailable: selectedEvents.some(
      (event) => event.evidence.reasoningTokens,
    ),
    systemPromptAvailable: selectedEvents.some(
      (event) => event.evidence.systemPromptTokens,
    ),
    skillUsage: skillUsage(selectedEvents),
    hasContextBreakdown: hasContextBreakdown(selectedEvents),
    measurement: measurementFor(selectedEvents),
  };
}
