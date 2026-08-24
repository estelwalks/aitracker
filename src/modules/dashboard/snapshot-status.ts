export type DashboardSnapshotRefreshStatus =
  "empty" | "fresh" | "stale" | "failed" | "refreshing";

export interface DashboardSnapshotProbe {
  readonly status: DashboardSnapshotRefreshStatus;
  readonly data: unknown;
  readonly warningCodes: readonly string[];
}

/**
 * A coordinator with no committed data reports `empty` even after a failed
 * collection. Its diagnostics retain `collection-failed`, which lets the
 * onboarding UI distinguish a first scan still in progress from one that
 * needs a retry.
 */
export function resolveDashboardSnapshotStatus(input: {
  readonly usage: DashboardSnapshotProbe;
  readonly sessions: DashboardSnapshotProbe;
}): DashboardSnapshotRefreshStatus {
  const snapshots = [input.usage, input.sessions];
  if (
    snapshots.some(
      (snapshot) =>
        snapshot.data == null &&
        snapshot.warningCodes.includes("collection-failed"),
    )
  )
    return "failed";
  if (snapshots.some((snapshot) => snapshot.status === "stale")) return "stale";
  if (snapshots.some((snapshot) => snapshot.status === "empty")) return "empty";
  if (snapshots.some((snapshot) => snapshot.status === "failed"))
    return "failed";
  if (snapshots.some((snapshot) => snapshot.status === "refreshing"))
    return "refreshing";
  return "fresh";
}
