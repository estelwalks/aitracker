export interface DesktopStartupTaskState {
  readonly platform: NodeJS.Platform;
  readonly taskId: string;
  readonly hasPersistedSnapshot: boolean;
}

/**
 * Windows must finish an empty workspace before first paint. Once a complete
 * snapshot exists, a stale refresh may continue behind the already initialized
 * homepage. macOS retains the existing strict refresh barrier.
 */
export function shouldAwaitDesktopStartupTask(
  state: DesktopStartupTaskState,
): boolean {
  if (state.platform !== "win32") return true;
  if (state.taskId === "exchange.refresh") return false;
  return !state.hasPersistedSnapshot;
}

/** Windows overlaps two collectors; other platforms retain the policy limit. */
export function desktopHeavyCollectorLimit(
  platform: NodeJS.Platform = process.platform,
): number | undefined {
  return platform === "win32" ? 2 : undefined;
}
