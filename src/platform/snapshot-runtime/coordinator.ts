import type {
  SnapshotDiagnostics,
  SnapshotEnvelope,
  SnapshotHydrateResult,
  SnapshotRefreshPort,
  SnapshotRefreshRequest,
  SnapshotRuntimeOptions,
  SnapshotStatus,
} from "./contracts.ts";

/**
 * P2-T2-03/04: SnapshotCoordinator.
 *
 * Responsibilities:
 * - Hydrates the persisted snapshot into memory exactly once (concurrent
 *   first reads share the same disk read).
 * - `readLatest()` is an O(1) in-memory read that never scans or schedules.
 * - `refresh()` runs the collector exactly once per in-flight request
 *   (single-flight), commits atomically on success and keeps last-known-good
 *   on failure/cancellation. Commit is aborted when the signal fires before
 *   the write starts.
 * - Exposes revision / freshness / refreshing / failure summaries without any
 *   sensitive payload.
 */

export interface SnapshotReadView<T> {
  readonly data: T | null;
  readonly status: SnapshotStatus;
  readonly revision: string | null;
  readonly generatedAt: string | null;
  readonly ageMs: number | null;
  readonly lastSuccessAt: string | null;
  readonly lastAttemptAt: string | null;
  readonly warningCodes: readonly string[];
  /** True when the data is stale but still readable (last-known-good). */
  readonly staleReadable: boolean;
}

export interface SnapshotCoordinator<T> {
  /** Ensures the persisted snapshot is in memory (idempotent, single hydrate). */
  ensureHydrated(): Promise<void>;
  /** O(1) read of the latest completed snapshot; never triggers a refresh. */
  readLatest(): SnapshotReadView<T>;
  /** Refreshes through the task runtime; single-flight per domain. */
  requestRefresh(request: SnapshotRefreshRequest): Promise<void>;
  /** Runs the collector inline (startup if-stale path). */
  refreshNow(signal?: AbortSignal): Promise<SnapshotReadView<T>>;
  /** Marks the snapshot invalid (mutation/event) and requests a refresh. */
  invalidate(request?: Partial<SnapshotRefreshRequest>): Promise<void>;
  /** Clears in-memory + persisted state (tests / policy changes). */
  clear(): Promise<void>;
  /** True while a refresh is in flight. */
  readonly refreshing: boolean;
}

const emptyDiagnostics = (): SnapshotDiagnostics => ({
  lastAttemptAt: null,
  lastSuccessAt: null,
  warningCodes: [],
});

function emptyEnvelope<T>(): SnapshotEnvelope<T> {
  return {
    schemaVersion: 1,
    revision: "empty",
    generatedAt: null,
    sourceFingerprint: null,
    status: "empty",
    data: null,
    diagnostics: emptyDiagnostics(),
  };
}

export function createSnapshotCoordinator<T>(
  options: SnapshotRuntimeOptions<T>,
): SnapshotCoordinator<T> {
  const now = options.now ?? Date.now;
  const createRevision =
    options.createRevision ??
    (() =>
      `rev-${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  let current: SnapshotEnvelope<T> = emptyEnvelope();
  let hydrated = false;
  let hydratePromise: Promise<void> | undefined;
  let refreshPromise: Promise<SnapshotReadView<T>> | undefined;
  let clearing = false;
  /** Explicit mutation/event invalidation wins over age-based freshness. */
  let invalidated = false;

  const statusOf = (envelope: SnapshotEnvelope<T>): SnapshotStatus => {
    if (invalidated && envelope.data != null) return "stale";
    if (envelope.status === "empty" || envelope.data == null) return "empty";
    if (envelope.generatedAt == null) return "stale";
    const age = Math.max(0, now() - Date.parse(envelope.generatedAt));
    return age <= options.freshForMs ? "fresh" : "stale";
  };

  const view = (envelope: SnapshotEnvelope<T>): SnapshotReadView<T> => {
    const status = statusOf(envelope);
    const generatedAt = envelope.generatedAt;
    return {
      data: envelope.data,
      status,
      revision: envelope.revision === "empty" ? null : envelope.revision,
      generatedAt,
      ageMs:
        generatedAt == null
          ? null
          : Math.max(0, now() - Date.parse(generatedAt)),
      lastSuccessAt: envelope.diagnostics.lastSuccessAt,
      lastAttemptAt: envelope.diagnostics.lastAttemptAt,
      warningCodes: envelope.diagnostics.warningCodes,
      staleReadable: envelope.data != null,
    };
  };

  const hydrate = async (): Promise<void> => {
    if (hydrated) return;
    if (!hydratePromise) {
      hydratePromise = (async () => {
        let result: SnapshotHydrateResult<T>;
        try {
          result = await options.repository.load();
        } catch {
          // A broken repository must not break page loads: keep in-memory empty
          // state and let the background refresh retry.
          current = emptyEnvelope();
          hydrated = true;
          return;
        }
        current = result.envelope;
        hydrated = true;
      })();
    }
    await hydratePromise;
  };

  const commit = async (
    data: T,
    extra: Partial<SnapshotEnvelope<T>> = {},
    signal?: AbortSignal,
  ): Promise<SnapshotEnvelope<T>> => {
    const nowIso = new Date(now()).toISOString();
    const next: SnapshotEnvelope<T> = {
      schemaVersion: 1,
      revision: createRevision(),
      generatedAt: nowIso,
      sourceFingerprint: null,
      status: "fresh",
      data,
      diagnostics: {
        ...emptyDiagnostics(),
        lastAttemptAt: nowIso,
        lastSuccessAt: nowIso,
      },
      ...extra,
    };
    // Abort-before-commit: a cancelled collector must never overwrite LKG.
    if (signal?.aborted) throw new AbortError("commit aborted");
    await options.repository.save(next);
    current = next;
    invalidated = false;
    return next;
  };

  const runRefresh = async (
    signal?: AbortSignal,
  ): Promise<SnapshotReadView<T>> => {
    const startedAt = now();
    try {
      const collected = await options.collect({
        signal: signal ?? new AbortController().signal,
        previous: current.data == null ? null : current,
      });
      const envelope = await commit(
        collected.data,
        {
          sourceFingerprint: collected.sourceFingerprint ?? null,
          diagnostics: {
            ...current.diagnostics,
            lastAttemptAt: new Date(startedAt).toISOString(),
            lastSuccessAt: new Date(now()).toISOString(),
            durationMs: now() - startedAt,
            ...(collected.scannedItems !== undefined
              ? { scannedItems: collected.scannedItems }
              : {}),
            ...(collected.reusedItems !== undefined
              ? { reusedItems: collected.reusedItems }
              : {}),
            warningCodes: current.diagnostics.warningCodes,
          },
        },
        signal,
      );
      void envelope;
      return view(current);
    } catch (caught) {
      // Keep last-known-good; record a stable failure summary.
      const nowIso = new Date(now()).toISOString();
      const failed: SnapshotEnvelope<T> = {
        ...current,
        diagnostics: {
          ...current.diagnostics,
          lastAttemptAt: nowIso,
          warningCodes: [
            ...new Set([
              ...current.diagnostics.warningCodes,
              caught instanceof Error && caught.name === "AbortError"
                ? "cancelled"
                : "collection-failed",
            ]),
          ],
        },
      };
      current = failed;
      return view(failed);
    }
  };

  return {
    get refreshing() {
      return refreshPromise !== undefined;
    },
    async ensureHydrated() {
      await hydrate();
    },
    readLatest() {
      return view(current);
    },
    async requestRefresh(request) {
      await hydrate();
      const port = options.requestRefresh;
      if (port) await port.requestRefresh(request);
    },
    async refreshNow(signal) {
      await hydrate();
      if (refreshPromise) return refreshPromise;
      refreshPromise = runRefresh(signal).finally(() => {
        refreshPromise = undefined;
      });
      return refreshPromise;
    },
    async invalidate(request = {}) {
      await hydrate();
      invalidated = true;
      const next: SnapshotEnvelope<T> = {
        ...current,
        status: "stale",
        diagnostics: {
          ...current.diagnostics,
          warningCodes: [
            ...new Set([...current.diagnostics.warningCodes, "invalidated"]),
          ],
        },
      };
      current = next;
      const port = options.requestRefresh;
      if (port) await port.requestRefresh({ reason: "event", ...request });
    },
    async clear() {
      clearing = true;
      current = emptyEnvelope();
      await options.repository.clear();
      hydrated = true;
      clearing = false;
    },
  };
}

class AbortError extends Error {
  readonly name = "AbortError";
}
