import type { LocalUsageEvent } from "../../../lib/local-usage/types.ts";

/**
 * Token burn leaderboard ("燃烧榜") pure logic. All inputs are real, sanitized
 * usage events; every figure (tokens, cache rate, waste index, trend) is
 * derived from observed token counts. There is deliberately no fabricated
 * ranking or mock hash trend — the MoM trend compares a real trailing window
 * against the one before it.
 */

export type RoastDimension = "skill" | "project" | "session";

export type RoastTrend = "up" | "down" | "flat" | null;

export type RoastSuggestion = "cache" | "output" | "volume" | "none";

export interface RoastRow {
  readonly key: string;
  readonly name: string;
  /** Agent/tool id for skill rows; omitted where not meaningful. */
  readonly source?: string;
  readonly tokens: number;
  readonly events: number;
  /** Total attributed skill calls (0 for project/session rows). */
  readonly calls: number;
  /** 0-100 cache-hit percent; null when no input-token denominator. */
  readonly cacheRate: number | null;
  /** outputTokens / totalTokens (0-1). */
  readonly outputRatio: number;
  /** 0-100 waste index; higher = more wasteful. */
  readonly waste: number;
  /** MoM token trend vs the preceding equal-length window. */
  readonly trend: RoastTrend;
  readonly previousTokens: number | null;
  readonly suggestion: RoastSuggestion;
}

export interface TrackerBoard {
  readonly rows: readonly RoastRow[];
}

export const RECENT_TREND_DAYS = 7;

/**
 * Waste index = 100 × (1 − cacheRate) × outputRatio, clamped to 0–100.
 * Low cache reuse combined with a high output-token share is treated as
 * waste; a fully cached, mostly-input workload scores near zero.
 */
export function wasteIndex(
  cacheRate: number | null,
  outputRatio: number,
): number {
  const cacheFactor = 1 - (cacheRate ?? 0) / 100;
  const ratio = Math.max(0, Math.min(1, outputRatio));
  return Math.max(0, Math.min(100, 100 * cacheFactor * ratio));
}

/** MoM trend: null when the previous window has no comparable evidence. */
export function computeMoM(
  current: number,
  previous: number | null,
): RoastTrend {
  if (previous == null || previous <= 0) return null;
  const delta = (current - previous) / previous;
  if (delta > 0.05) return "up";
  if (delta < -0.05) return "down";
  return "flat";
}

/** Deterministic optimization suggestion driven by the row's real factors. */
export function suggestionFor(input: {
  cacheRate: number | null;
  outputRatio: number;
  tokens: number;
}): RoastSuggestion {
  if (input.cacheRate != null && input.cacheRate < 40) return "cache";
  if (input.outputRatio > 0.6) return "output";
  if (input.tokens >= 100_000) return "volume";
  return "none";
}

interface Acc {
  tokens: number;
  events: number;
  calls: number;
  outputTokens: number;
  cachedInputTokens: number;
  netInputTokens: number;
  recentTokens: number;
  previousTokens: number;
}

const emptyAcc = (): Acc => ({
  tokens: 0,
  events: 0,
  calls: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  netInputTokens: 0,
  recentTokens: 0,
  previousTokens: 0,
});

const DAY_MS = 24 * 60 * 60 * 1000;

function rowFor(key: string, source: string | undefined, acc: Acc): RoastRow {
  const denominator = acc.netInputTokens + acc.cachedInputTokens;
  const cacheRate =
    denominator > 0 ? (acc.cachedInputTokens / denominator) * 100 : null;
  const outputRatio = acc.tokens > 0 ? acc.outputTokens / acc.tokens : 0;
  const previous = acc.previousTokens > 0 ? acc.previousTokens : null;
  return {
    key,
    name: key,
    ...(source === undefined ? {} : { source }),
    tokens: Math.round(acc.tokens),
    events: acc.events,
    calls: acc.calls,
    cacheRate,
    outputRatio,
    waste: Math.round(wasteIndex(cacheRate, outputRatio) * 10) / 10,
    trend: computeMoM(acc.recentTokens, previous),
    previousTokens: previous === null ? null : Math.round(previous),
    suggestion: suggestionFor({
      cacheRate,
      outputRatio,
      tokens: acc.tokens,
    }),
  };
}

/**
 * Build a ranked board for one dimension. Skill rows attribute each event's
 * tokens to its skills by the skill-call share within that event; project and
 * session rows map each event one-to-one. Rows sort by token consumption
 * (highest first), using waste index only as a tie-breaker.
 */
export function buildBoard(
  events: readonly LocalUsageEvent[],
  dimension: RoastDimension,
): TrackerBoard {
  const accs = new Map<string, { acc: Acc; source?: string }>();
  const now = Date.now();
  const recentStart = now - RECENT_TREND_DAYS * DAY_MS;
  const previousStart = now - 2 * RECENT_TREND_DAYS * DAY_MS;

  const add = (
    key: string,
    source: string | undefined,
    tokens: number,
    outputTokens: number,
    cachedInputTokens: number,
    netInputTokens: number,
    calls: number,
    timestamp: string,
  ) => {
    let entry = accs.get(key);
    if (!entry) {
      entry = { acc: emptyAcc(), source };
      accs.set(key, entry);
    }
    const acc = entry.acc;
    acc.tokens += tokens;
    acc.events += 1;
    acc.calls += calls;
    acc.outputTokens += outputTokens;
    acc.cachedInputTokens += cachedInputTokens;
    acc.netInputTokens += netInputTokens;
    const time = Date.parse(timestamp);
    if (!Number.isNaN(time)) {
      if (time >= recentStart) acc.recentTokens += tokens;
      else if (time >= previousStart) acc.previousTokens += tokens;
    }
  };

  for (const event of events) {
    const output = event.outputTokens ?? 0;
    const cached = event.cachedInputTokens ?? 0;
    const net =
      (event.inputTokens ?? 0) + (event.cacheCreationInputTokens ?? 0);
    const total = event.totalTokens ?? output + net + cached;

    if (dimension === "skill") {
      const skills = event.context?.skills ?? [];
      if (skills.length === 0) continue;
      const totalCalls = skills.reduce(
        (sum, skill) => sum + (skill.calls || 0),
        0,
      );
      if (totalCalls <= 0) continue;
      for (const skill of skills) {
        const share = (skill.calls || 0) / totalCalls;
        add(
          skill.name,
          event.source,
          total * share,
          output * share,
          cached * share,
          net * share,
          skill.calls || 0,
          event.timestamp,
        );
      }
    } else if (dimension === "project") {
      add(
        event.project,
        event.source,
        total,
        output,
        cached,
        net,
        0,
        event.timestamp,
      );
    } else {
      if (!event.sessionId) continue;
      add(
        event.sessionId,
        event.source,
        total,
        output,
        cached,
        net,
        0,
        event.timestamp,
      );
    }
  }

  const rows = [...accs.entries()].map(([key, entry]) =>
    rowFor(key, entry.source, entry.acc),
  );
  rows.sort((a, b) => b.tokens - a.tokens || b.waste - a.waste);
  return { rows };
}

/** Sum the token consumption represented by one selected leaderboard. */
export function tokensForDimension(
  boards: Readonly<Record<RoastDimension, TrackerBoard>>,
  dimension: RoastDimension,
): number {
  return boards[dimension].rows.reduce((total, row) => total + row.tokens, 0);
}

/** Aggregate totals across all three dimensions for general usage summaries. */
export function aggregateBoards(boards: readonly TrackerBoard[]): {
  tokens: number;
  events: number;
  entries: number;
} {
  const seen = new Set<string>();
  let tokens = 0;
  let events = 0;
  let entries = 0;
  for (const board of boards) {
    for (const row of board.rows) {
      if (!seen.has(row.key)) {
        seen.add(row.key);
        entries += 1;
      }
      tokens += row.tokens;
      events += row.events;
    }
  }
  return { tokens, events, entries };
}

/**
 * Return the initial page totals for the default Project leaderboard. The
 * selected leaderboard's live token total is derived by tokensForDimension.
 */
export function trackerTotalsFromEvents(
  events: readonly LocalUsageEvent[],
  boards: Readonly<Record<RoastDimension, TrackerBoard>>,
): { tokens: number; events: number; entries: number } {
  return {
    tokens: tokensForDimension(boards, "project"),
    events: events.length,
    entries: (Object.values(boards) as readonly TrackerBoard[]).reduce(
      (total, board) => total + board.rows.length,
      0,
    ),
  };
}
