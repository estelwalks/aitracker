import type { DashboardSnapshotStatus } from "../summary-query.ts";

export type WorkspaceInitializationState = "idle" | "loading" | "failed";

/**
 * Restrict the onboarding state to a genuinely empty dashboard. Existing
 * workspace data stays visible even when a later background refresh fails.
 */
export function resolveWorkspaceInitializationState(input: {
  readonly hasUsageData: boolean;
  readonly hasSessionData: boolean;
  readonly snapshotStatus: DashboardSnapshotStatus["status"];
}): WorkspaceInitializationState {
  if (input.hasUsageData || input.hasSessionData) return "idle";
  if (input.snapshotStatus === "failed") return "failed";
  return input.snapshotStatus === "empty" ||
    input.snapshotStatus === "refreshing"
    ? "loading"
    : "idle";
}
