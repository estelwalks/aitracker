import type { DistillationSessionItem } from "../index.ts";

/** Values exposed by the workbench time-range toolbar. */
export type DistillationTimeRange = "today" | "7" | "30" | "all";

/** The material picker can select individual sessions or complete projects. */
export type DistillationMaterialGranularity = "session" | "project";

export interface DistillationProjectMaterial {
  /** Source is included because project keys are not globally unique. */
  readonly key: string;
  readonly source: string;
  readonly projectKey: string;
  readonly sessions: readonly DistillationSessionItem[];
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Applies the selected workbench range to renderer-safe session metadata.
 * Invalid timestamps are deliberately excluded from finite ranges: presenting
 * them as recent would be a fabricated recency signal. They remain available
 * under "all" so the user can still select a real, legacy session.
 */
export function filterDistillationSessions(
  sessions: readonly DistillationSessionItem[],
  range: DistillationTimeRange,
  now = new Date(),
): readonly DistillationSessionItem[] {
  if (range === "all") return sessions;

  const today = startOfLocalDay(now);
  const days = range === "today" ? 0 : Number(range) - 1;
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - days);

  return sessions.filter((session) => {
    const startedAt = new Date(session.startedAt);
    return !Number.isNaN(startedAt.getTime()) && startedAt >= cutoff;
  });
}

/**
 * Groups only the currently range-filtered sessions. A project can therefore
 * be selected as a real set of session refs without accidentally including
 * sessions outside the visible time scope.
 */
export function groupDistillationSessionsByProject(
  sessions: readonly DistillationSessionItem[],
): readonly DistillationProjectMaterial[] {
  const groups = new Map<string, DistillationProjectMaterial>();
  for (const session of sessions) {
    const key = `${session.source}:${session.projectKey}`;
    const current = groups.get(key);
    if (current) {
      groups.set(key, { ...current, sessions: [...current.sessions, session] });
    } else {
      groups.set(key, {
        key,
        source: session.source,
        projectKey: session.projectKey,
        sessions: [session],
      });
    }
  }
  return [...groups.values()];
}

export function materialKeyOf(item: {
  readonly source: string;
  readonly sessionId: string;
}): string {
  return `${item.source}:${item.sessionId}`;
}
