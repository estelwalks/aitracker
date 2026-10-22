import type { PlatformOs } from "../tool-registry/registry.ts";
import {
  syncCursorAccountUsage,
  type CursorAccountSyncResult,
} from "./sync.server.ts";

export interface RunCursorAccountSyncOptions {
  readonly homeDirectory: string;
  readonly platform?: PlatformOs;
  readonly enabled: boolean;
  readonly signal?: AbortSignal;
  readonly now?: () => number;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Single-flight wrapper around one Cursor sync.
 *
 * The scheduled task (hourly) and the manual "sync now" button can overlap;
 * running them twice would send two identical account requests and race two
 * cache writes, so the second caller joins the in-flight run instead.
 */
let inFlight: Promise<CursorAccountSyncResult> | null = null;

export function runCursorAccountSync(
  options: RunCursorAccountSyncOptions,
): Promise<CursorAccountSyncResult> {
  if (!options.enabled) {
    return syncCursorAccountUsage({
      homeDirectory: options.homeDirectory,
      ...(options.platform == null ? {} : { platform: options.platform }),
      enabled: false,
    });
  }
  if (inFlight != null) return inFlight;
  const run = syncCursorAccountUsage({
    homeDirectory: options.homeDirectory,
    ...(options.platform == null ? {} : { platform: options.platform }),
    enabled: true,
    ...(options.signal == null ? {} : { signal: options.signal }),
    ...(options.now == null ? {} : { now: options.now }),
    ...(options.fetchImpl == null ? {} : { fetchImpl: options.fetchImpl }),
  }).finally(() => {
    inFlight = null;
  });
  inFlight = run;
  return run;
}

/** Test seam: drops the in-flight reference between cases. */
export function resetCursorAccountSyncForTests(): void {
  inFlight = null;
}
