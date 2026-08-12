/**
 * Period math + real session-density aggregation for the reports page
 * (archive band, PeriodCalendar, report header stats).
 *
 * Pure and framework-neutral: no `node:` imports, no I/O, only `Date` math and
 * the session aggregate shape. The server transport (`api.server.ts`) loads
 * real sessions via the composition root's sessions port and feeds them to
 * `aggregateSessionDensity`; the renderer consumes the resulting serializable
 * `SessionDensity` through the read model.
 *
 * Day keys are local-time `YYYY-MM-DD` strings (zero-padded), so lexicographic
 * comparison is chronological. A week is identified by its Monday's day key; a
 * month by its `YYYY-MM`.
 */
export type PeriodGranularity = "day" | "week" | "month";

/** One real day of session activity (from persisted usage, never mocked). */
export interface SessionDayMetric {
  readonly count: number;
  readonly tokens: number;
  readonly knownUsd: number;
}

/** Compact, serializable density model: per-day metrics + overall total. */
export interface SessionDensity {
  readonly total: number;
  readonly days: Record<string, SessionDayMetric>;
}

const pad = (value: number): string => String(value).padStart(2, "0");

/** Local-time `YYYY-MM-DD` day key. */
export function dayKeyOf(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local-time `YYYY-MM` month key. */
export function monthKeyOf(date: Date): string {
  return dayKeyOf(date).slice(0, 7);
}

/** Monday 00:00 of the week containing `date` (Monday-first, per the prototype). */
export function startOfWeek(date: Date): Date {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const mondayOffset = (day.getDay() + 6) % 7;
  day.setDate(day.getDate() - mondayOffset);
  return day;
}

/** Local-time day key of the Monday opening the week containing `date`. */
export function weekKeyOf(date: Date): string {
  return dayKeyOf(startOfWeek(date));
}

/** Period key for a granularity: day/week/month key of `date`. */
export function periodKeyOf(
  granularity: PeriodGranularity,
  date: Date,
): string {
  if (granularity === "day") return dayKeyOf(date);
  if (granularity === "week") return weekKeyOf(date);
  return monthKeyOf(date);
}

/**
 * Local-time start (inclusive) of a period key. `YYYY-MM-DD` for day/week
 * (the week key is its Monday), `YYYY-MM-01` for month.
 */
export function periodStartDate(
  granularity: PeriodGranularity,
  key: string,
): Date | null {
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3] ?? 1);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  if (granularity === "week") {
    // A week key is its Monday; any week whose Monday is in a different
    // month still parses as that date.
    return startOfWeek(date);
  }
  if (granularity === "month") return new Date(year, month - 1, 1);
  return date;
}

/** Exclusive end date of a period (used for `key >= start && key < end`). */
export function periodEndDate(
  granularity: PeriodGranularity,
  key: string,
): Date | null {
  const start = periodStartDate(granularity, key);
  if (!start) return null;
  if (granularity === "day") {
    return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  }
  if (granularity === "week") {
    return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  }
  return new Date(start.getFullYear(), start.getMonth() + 1, 1);
}

/** `periodKeyOf` shifted by `delta` periods (negative = earlier). */
export function addPeriods(
  granularity: PeriodGranularity,
  key: string,
  delta: number,
): string {
  const start = periodStartDate(granularity, key);
  if (!start) return key;
  if (granularity === "day") {
    return dayKeyOf(
      new Date(start.getFullYear(), start.getMonth(), start.getDate() + delta),
    );
  }
  if (granularity === "week") {
    return dayKeyOf(
      new Date(
        start.getFullYear(),
        start.getMonth(),
        start.getDate() + 7 * delta,
      ),
    );
  }
  return monthKeyOf(new Date(start.getFullYear(), start.getMonth() + delta, 1));
}

/** True when `dayKey` falls inside the period identified by `key`. */
export function periodContains(
  granularity: PeriodGranularity,
  key: string,
  dayKey: string,
): boolean {
  const start = periodStartDate(granularity, key);
  const end = periodEndDate(granularity, key);
  if (!start || !end) return false;
  return dayKey >= dayKeyOf(start) && dayKey < dayKeyOf(end);
}

/**
 * Sum the real day metrics inside a period. Iterates the density map so the
 * renderer can aggregate any granularity from one serialized payload.
 */
export function sumPeriodDensity(
  density: SessionDensity,
  granularity: PeriodGranularity,
  key: string,
): SessionDayMetric {
  let count = 0;
  let tokens = 0;
  let knownUsd = 0;
  for (const [dayKey, metric] of Object.entries(density.days)) {
    if (!periodContains(granularity, key, dayKey)) continue;
    count += metric.count;
    tokens += metric.tokens;
    knownUsd += metric.knownUsd;
  }
  return { count, tokens, knownUsd };
}

/**
 * Aggregate real sessions into a per-day density map. Only the privacy-safe
 * `startedAt`, token total and known USD cost are read — never session bodies
 * or paths. Sessions outside any valid date are skipped.
 */
export function aggregateSessionDensity(
  sessions: readonly {
    startedAt: string;
    totals?: { totalTokens?: number };
    cost?: { knownUsd?: number };
  }[],
): SessionDensity {
  const days: Record<string, SessionDayMetric> = {};
  let total = 0;
  for (const session of sessions) {
    const date = new Date(session.startedAt);
    if (Number.isNaN(date.getTime())) continue;
    const key = dayKeyOf(date);
    const previous = days[key];
    days[key] = {
      count: (previous?.count ?? 0) + 1,
      tokens: (previous?.tokens ?? 0) + (session.totals?.totalTokens ?? 0),
      knownUsd: (previous?.knownUsd ?? 0) + (session.cost?.knownUsd ?? 0),
    };
    total += 1;
  }
  return { total, days };
}

/** Label-safe day key for display (keeps YYYY-MM-DD without tz shift). */
export function parseDayKey(key: string): Date | null {
  return periodStartDate("day", key);
}
