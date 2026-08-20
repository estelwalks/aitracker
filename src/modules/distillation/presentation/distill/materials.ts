import type { DistillationSessionItem } from "../index.ts";

/** Values exposed by the workbench time-range toolbar. */
export type DistillationTimeRange = "today" | "7" | "30" | "all";

/**
 * The material picker can select individual sessions or complete projects.
 * The prototype keeps a "config" material mode in its type but hardcodes the
 * state to "chat", so it is never reachable — the workbench drops it entirely.
 */
export type DistillationMaterialGranularity = "session" | "project";

export interface DistillationProjectMaterial {
  /** The sanitized project name; merged across agent sources like the prototype. */
  readonly key: string;
  readonly projectKey: string;
  /** Deduplicated agent sources backing this project (drives stacked icons). */
  readonly sources: readonly string[];
  readonly sessions: readonly DistillationSessionItem[];
  /** Latest session start (project-row date label). */
  readonly last: string;
}

/**
 * Heuristic tokens-per-turn used to estimate a session/project's material
 * size. The privacy-safe renderer projection omits raw token totals, so the
 * estimate is always presented with the "~" prefix (E-200).
 */
export const EST_TOKENS_PER_TURN = 900;

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
 *
 * Only git-backed projects count as "projects": sessions whose cwd resolved
 * to no repository fall back to their folder name and would otherwise appear
 * as fake projects (e.g. `~/.claude/projects/<hash>`). They remain selectable
 * individually under the "by session" granularity, just not as a project.
 *
 * Like the prototype, a project is merged across agent sources by its
 * sanitized name (the project row shows the stacked sources), and the row's
 * date label is the latest session start among its members.
 */
export function groupDistillationSessionsByProject(
  sessions: readonly DistillationSessionItem[],
): readonly DistillationProjectMaterial[] {
  const groups = new Map<string, DistillationProjectMaterial>();
  for (const session of sessions) {
    if (session.isGitProject !== true) continue;
    const key = session.projectKey;
    const current = groups.get(key);
    if (current) {
      groups.set(key, {
        ...current,
        sources: [...new Set([...current.sources, session.source])],
        sessions: [...current.sessions, session],
        last:
          session.startedAt > current.last ? session.startedAt : current.last,
      });
    } else {
      groups.set(key, {
        key,
        projectKey: session.projectKey,
        sources: [session.source],
        sessions: [session],
        last: session.startedAt,
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
 * Applies a single-session checkbox transition. Returns the original Set
 * instance when the key is already present and removed — React re-renders on
 * the new Set, and toggling the same key twice returns a stable identity for
 * no-op renders.
 */
export function toggleMaterialSelection(
  current: ReadonlySet<string>,
  key: string,
): ReadonlySet<string> {
  const next = new Set(current);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  return next;
}

/**
 * Project selection is atomic: either every missing real session is added, or
 * the existing selection is preserved. This avoids presenting a
 * partially-selected project as though it had been distilled in full. The
 * prototype accumulates sessions without a count limit, so there is no cap to
 * reject against — the atomicity is about all-or-nothing, not capacity.
 */
export function toggleProjectSelection(
  current: ReadonlySet<string>,
  projectKeys: readonly string[],
): ReadonlySet<string> {
  const uniqueKeys = [...new Set(projectKeys)];
  const selectedEverySession =
    uniqueKeys.length > 0 && uniqueKeys.every((key) => current.has(key));
  const next = new Set(current);
  if (selectedEverySession) {
    for (const key of uniqueKeys) next.delete(key);
    return next;
  }
  for (const key of uniqueKeys) next.add(key);
  return next;
}
