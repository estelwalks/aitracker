import type { SessionSummary } from "../contracts.ts";

/**
 * P3-T3-01: Session snapshot data contract.
 *
 * The snapshot stores the browser-safe session summaries (never commands or
 * transcript content) plus pre-aggregated report density rows so Reports can
 * paginate over one snapshot read instead of re-scanning per page.
 *
 * `SessionSnapshotRecord` additionally carries the server-only raw `projectRef`
 * (cwd) so the dashboard adapter can classify sessions into the same project
 * labels as usage events. The reference never crosses to the browser:
 * `snapshot-session-repository` strips it at the query boundary and the
 * dashboard reduces it to display-safe aggregates. It mirrors what the usage
 * snapshot already persists for events (`details[].project`), so no new path
 * data is introduced server-side.
 */

/** Per-day session density (source x day) used by Reports projections. */
export interface SessionDensityRow {
  readonly source: string;
  readonly date: string;
  readonly count: number;
  readonly turns: number;
  readonly editTurns: number;
  readonly subagentCalls: number;
  readonly totalTokens: number;
  readonly knownUsd: number;
}

/** Server-only record persisted in the snapshot; `projectRef` is stripped at every browser boundary. */
export type SessionSnapshotRecord = SessionSummary & {
  readonly projectRef?: string;
};

export interface SessionSnapshotData {
  readonly generatedAt: string;
  readonly sessions: readonly SessionSnapshotRecord[];
  /** Pre-aggregated density for report projections (T3-01). */
  readonly density: readonly SessionDensityRow[];
}

export function buildSessionDensity(
  sessions: readonly SessionSummary[],
): readonly SessionDensityRow[] {
  const rows = new Map<
    string,
    {
      source: string;
      date: string;
      count: number;
      turns: number;
      editTurns: number;
      subagentCalls: number;
      totalTokens: number;
      knownUsd: number;
    }
  >();
  for (const session of sessions) {
    const date = session.startedAt.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) continue;
    const key = `${session.source}\u0000${date}`;
    const current = rows.get(key) ?? {
      source: session.source,
      date,
      count: 0,
      turns: 0,
      editTurns: 0,
      subagentCalls: 0,
      totalTokens: 0,
      knownUsd: 0,
    };
    current.count += 1;
    current.turns += session.turns;
    current.editTurns += session.editTurns;
    current.subagentCalls += session.subagentCalls;
    current.totalTokens += session.totals.totalTokens;
    current.knownUsd += session.cost.knownUsd;
    rows.set(key, current);
  }
  return [...rows.values()].sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      left.source.localeCompare(right.source),
  );
}
