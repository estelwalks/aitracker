import type { DashboardSnapshotStatus } from "../summary-query.ts";

export interface DashboardSyncInput {
  readonly navigationPending: boolean;
  readonly summaryFetching: boolean;
  readonly summaryRevision: string | null;
  readonly sessionsAvailable: boolean;
  readonly status: DashboardSnapshotStatus | null;
}

/**
 * Decide whether the lightweight snapshot probe discovered data that the
 * mounted Dashboard query has not consumed yet. The decision is deliberately
 * independent from the router: refreshing Dashboard content must never put a
 * navigation back into its pending state.
 */
export function shouldRefreshDashboardSummary(
  input: DashboardSyncInput,
): boolean {
  if (
    input.navigationPending ||
    input.summaryFetching ||
    input.status == null ||
    input.summaryRevision == null
  ) {
    return false;
  }

  if (
    input.status.status === "failed" ||
    input.status.status === "refreshing"
  ) {
    return false;
  }

  if (input.status.status === "stale") return true;
  if (
    input.status.revision != null &&
    input.status.revision !== input.summaryRevision
  ) {
    return true;
  }
  if (input.status.status === "empty" && input.status.revision != null) {
    return true;
  }

  // A session refresh can complete without replacing the legacy usage
  // revision returned by the status endpoint. Refresh once on the resulting
  // fresh status so a previously unavailable real session count can appear.
  return input.status.status === "fresh" && !input.sessionsAvailable;
}

/** Stable identity used to consume each status transition at most once. */
export function dashboardSnapshotSignature(
  status: DashboardSnapshotStatus,
): string {
  return [
    status.status,
    status.revision ?? "none",
    status.generatedAt ?? "none",
  ].join(":");
}
