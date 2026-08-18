import type { SessionRepository } from "../contracts.ts";
import type { SessionSnapshotData } from "./session-snapshot.contracts.ts";

/**
 * P3-T3-01 (fix): Session repository backed by the SessionSnapshot
 * coordinator.
 *
 * The sessions page and the distillation transport previously went through
 * `createLegacySessionRepository`, which re-ran the full local session scan on
 * every query. This adapter reads the persisted snapshot index (O(1) after
 * hydrate) so page queries never scan. An empty snapshot triggers one
 * non-blocking background refresh and returns an empty list immediately —
 * pages render the shell/empty state while the collector runs in the
 * background (design §4.3, loader rule 4).
 */
export interface SessionSnapshotReader {
  ensureHydrated(): Promise<void>;
  readLatest(): {
    readonly data: SessionSnapshotData | null;
    readonly status: "empty" | "fresh" | "stale" | "refreshing" | "failed";
    readonly revision: string | null;
    readonly generatedAt: string | null;
  };
  refreshNow(signal?: AbortSignal): Promise<unknown>;
  /**
   * P3-T3-11: routes an empty-state refresh through the unified task runtime
   * (single-flight against scheduled runs, run records, heavy budget).
   */
  requestRefresh(request: {
    reason: "startup" | "schedule" | "manual" | "event" | "empty";
    signal?: AbortSignal;
  }): Promise<void>;
}

export function createSnapshotSessionRepository(
  reader: SessionSnapshotReader,
): SessionRepository {
  return {
    async list(signal) {
      if (signal?.aborted) return [];
      await reader.ensureHydrated();
      const latest = reader.readLatest();
      if (latest.data == null) {
        // Empty snapshot: fire-and-forget task-runtime refresh, never block.
        void reader.requestRefresh({ reason: "empty", signal }).catch(() => {});
        return [];
      }
      return [...latest.data.sessions];
    },
  };
}
