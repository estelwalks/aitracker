import type { DistillationSessionItem } from "../index.ts";

/** Values exposed by the workbench time-range toolbar. */
export type DistillationTimeRange = "today" | "7" | "30" | "all";

/**
 * The material picker can select individual sessions, complete projects, or
 * the prototype's "config" material mode (tool prompt/rule files). The config
 * mode currently has no real file source, so the UI shows an honest empty
 * state and blocks the run until the data layer exposes such files.
 */
export type DistillationMaterialGranularity = "session" | "project" | "config";

/** True when the material mode selects tool config files instead of sessions. */
export function isConfigMaterial(
  granularity: DistillationMaterialGranularity,
): boolean {
  return granularity === "config";
}

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

function startOfNextLocalDay(date: Date): Date {
  const next = startOfLocalDay(date);
  next.setDate(next.getDate() + 1);
  return next;
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
  const tomorrow = startOfNextLocalDay(now);
  const days = range === "today" ? 0 : Number(range) - 1;
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - days);

  return sessions.filter((session) => {
    const startedAt = new Date(session.startedAt);
    return (
      !Number.isNaN(startedAt.getTime()) &&
      startedAt >= cutoff &&
      startedAt < tomorrow
    );
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

/**
 * Applies a single-session checkbox transition without ever exceeding the
 * server contract's opaque-ref limit. Returning the original Set instance on
 * a rejected addition lets React avoid a redundant render and makes the
 * boundary behaviour straightforward to unit test.
 */
export function toggleMaterialSelection(
  current: ReadonlySet<string>,
  key: string,
  maxSelection: number,
): ReadonlySet<string> {
  const next = new Set(current);
  if (next.has(key)) {
    next.delete(key);
    return next;
  }
  if (next.size >= maxSelection) return current;
  next.add(key);
  return next;
}

/**
 * Project selection is atomic: either every missing real session fits and is
 * added, or the existing selection is preserved. This avoids presenting a
 * partially-selected project as though it had been distilled in full.
 */
export function toggleProjectSelection(
  current: ReadonlySet<string>,
  projectKeys: readonly string[],
  maxSelection: number,
): ReadonlySet<string> {
  const uniqueKeys = [...new Set(projectKeys)];
  const selectedEverySession =
    uniqueKeys.length > 0 && uniqueKeys.every((key) => current.has(key));
  const next = new Set(current);
  if (selectedEverySession) {
    for (const key of uniqueKeys) next.delete(key);
    return next;
  }
  const missing = uniqueKeys.filter((key) => !next.has(key));
  if (next.size + missing.length > maxSelection) return current;
  for (const key of missing) next.add(key);
  return next;
}
