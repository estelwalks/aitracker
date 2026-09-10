import type { MonitoringSecuritySummary } from "../monitoring/contracts";

/**
 * Canonical security-overview read model.
 *
 * One server-side computation shared by every surface that shows “how many
 * local Skill assets were scanned and what they look like” — the dashboard
 * posture cards, the Skill management KPIs and the insight evidence. It is
 * resolved by `resolveSecurityOverview()` (server only) against the real
 * security engine that lives in the current process (Electron main in the
 * packaged app, the dev runtime in browser development) and falls back to the
 * persisted scan history when no engine is reachable.
 *
 * Unlike the old renderer hook (`useSecurityScanOverview`) this model arrives
 * with the rest of the server-composed data, so consumers never render a
 * second “pending” state: `available: false` is a terminal, honest state
 * (no engine reachable), never a loading placeholder.
 */
export interface SecurityOverviewReadModel {
  /**
   * True when a real security engine was reached and its discovery/history
   * were read successfully. False means “no engine” — consumers keep their
   * monitoring-derived fallback.
   */
  readonly available: boolean;
  /**
   * Content-unique count of currently discovered Skill copies that have scan
   * history (the “scanned” numerator of the posture cards).
   */
  readonly coverage: number;
  /** Distinct scan runs recorded by the engine (not history rows). */
  readonly runCount: number;
  /**
   * Content-unique count of all discovered Skill copies on this machine (the
   * posture denominator; identical copies across Agents merge).
   */
  readonly totalSkills: number;
  /** Safe/unsafe split over the scanned copies; null when nothing scanned. */
  readonly summary: MonitoringSecuritySummary | null;
  /** When the overview was resolved (engine path only); null when no engine. */
  readonly resolvedAt: string | null;
}
