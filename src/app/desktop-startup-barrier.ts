export interface DesktopStartupTaskState {
  readonly platform: NodeJS.Platform;
  readonly taskId: string;
  readonly hasPersistedSnapshot: boolean;
}

/**
 * Supported desktop platforms must finish an empty workspace before first
 * paint. Once a complete snapshot exists, a stale refresh may continue behind
 * the already initialized homepage. Network-only exchange refreshes never
 * belong to the native startup barrier.
 */
export function shouldAwaitDesktopStartupTask(
  state: DesktopStartupTaskState,
): boolean {
  if (state.platform !== "darwin" && state.platform !== "win32") return true;
  if (state.taskId === "exchange.refresh") return false;
  return !state.hasPersistedSnapshot;
}

/** Windows overlaps two collectors; other platforms retain the policy limit. */
export function desktopHeavyCollectorLimit(
  platform: NodeJS.Platform = process.platform,
): number | undefined {
  return platform === "win32" ? 2 : undefined;
}
