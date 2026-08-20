import type { SessionSnapshotData } from "./session-snapshot.contracts.ts";
import { buildSessionDensity } from "./session-snapshot.contracts.ts";
import { createSnapshotCoordinator } from "../../../platform/snapshot-runtime/coordinator.ts";
import type { SnapshotEnvelope } from "../../../platform/snapshot-runtime/contracts.ts";
import type { SnapshotRepository } from "../../../platform/snapshot-runtime/contracts.ts";
import type { SnapshotRefreshPort } from "../../../platform/snapshot-runtime/contracts.ts";
import { RUNTIME_POLICY } from "../../../app/runtime-policy.generated.ts";

/** Bump when the session registry/path/parser contract changes. */
export const SESSION_COLLECTOR_VERSION = "sessions-v2-dsh";

/**
 * P3-T3-01: Session snapshot coordinator.
 *
 * The session scanner is wrapped as a pure collector adapter (an
 * external-source read-only collection adapter) — it receives an AbortSignal, returns browser-safe summaries plus pre-aggregated
 * density, and never writes. Pages and Reports read the coordinator (O(1)),
 * so no page query re-scans the local session logs.
 */

export interface SessionSnapshotRuntimeOptions {
  readonly repository: SnapshotRepository<SessionSnapshotData>;
  readonly requestRefresh?: SnapshotRefreshPort;
  readonly now?: () => number;
  readonly collect?: (request: {
    readonly signal: AbortSignal;
    readonly previous: SnapshotEnvelope<SessionSnapshotData> | null;
  }) => Promise<{
    readonly data: SessionSnapshotData;
    readonly sourceFingerprint?: string | null;
    readonly scannedItems?: number;
    readonly reusedItems?: number;
  }>;
}

export interface SessionSnapshotRuntime {
  ensureHydrated(): Promise<void>;
  readLatest(): {
    readonly data: SessionSnapshotData | null;
    readonly status: "empty" | "fresh" | "stale" | "refreshing" | "failed";
    readonly revision: string | null;
    readonly generatedAt: string | null;
    readonly lastSuccessAt: string | null;
    readonly warningCodes: readonly string[];
  };
  refreshNow(signal?: AbortSignal): Promise<{
    readonly data: SessionSnapshotData | null;
    readonly status: "empty" | "fresh" | "stale" | "refreshing" | "failed";
    readonly revision: string | null;
    readonly generatedAt: string | null;
    readonly lastSuccessAt: string | null;
    readonly warningCodes: readonly string[];
  }>;
  requestRefresh(request: {
    reason: "startup" | "schedule" | "manual" | "event" | "empty" | "stale";
    signal?: AbortSignal;
  }): Promise<void>;
  invalidate(): Promise<void>;
  clear(): Promise<void>;
  readonly refreshing: boolean;
}

export function createSessionSnapshotRuntime(
  options: SessionSnapshotRuntimeOptions,
): SessionSnapshotRuntime {
  let collectorVersionChecked = false;
  const collectSource =
    options.collect ??
    (async ({ signal }) => {
      if (signal?.aborted) {
        return {
          data: {
            collectorVersion: SESSION_COLLECTOR_VERSION,
            generatedAt: new Date().toISOString(),
            sessions: [],
            density: [],
          },
          sourceFingerprint: new Date().toISOString(),
          scannedItems: 0,
        };
      }
      const { scanLocalSessions } =
        await import("../../../lib/local-sessions/scanner.server.ts");
      const { toPublicSession } = await import("./session-adapter.server.ts");
      const summary = await scanLocalSessions({ signal });
      // Public summary + server-only raw cwd. The dashboard adapter classifies
      // sessions into the same project labels as usage events; every browser
      // boundary (snapshot-session-repository, dashboard aggregates) strips
      // `projectRef` before it can reach the renderer.
      const sessions = summary.sessions.map((record) => ({
        ...toPublicSession(record),
        projectRef: record.projectRef,
      }));
      return {
        data: {
          collectorVersion: SESSION_COLLECTOR_VERSION,
          generatedAt: new Date().toISOString(),
          sessions,
          density: buildSessionDensity(sessions),
        },
        sourceFingerprint: new Date().toISOString(),
        scannedItems: sessions.length,
      };
    });

  const collect = async (
    request: Parameters<
      NonNullable<SessionSnapshotRuntimeOptions["collect"]>
    >[0],
  ) => {
    const result = await collectSource(request);
    return {
      ...result,
      // Persist the scanner contract version in the generic generation
      // fingerprint column as well; SQLite reloads the envelope metadata but
      // intentionally does not persist arbitrary runtime-only fields.
      sourceFingerprint: SESSION_COLLECTOR_VERSION,
      data: {
        ...result.data,
        collectorVersion:
          result.data.collectorVersion ?? SESSION_COLLECTOR_VERSION,
      },
    };
  };

  const coordinator = createSnapshotCoordinator<SessionSnapshotData>({
    repository: options.repository,
    requestRefresh: options.requestRefresh,
    now: options.now,
    freshForMs:
      RUNTIME_POLICY.snapshotPolicies.sessions.freshForMinutes * 60 * 1000,
    collect,
  });

  const toView = (
    view: ReturnType<typeof coordinator.readLatest>,
  ): ReturnType<SessionSnapshotRuntime["readLatest"]> => ({
    data: view.data,
    status: view.status,
    revision: view.revision,
    generatedAt: view.generatedAt,
    lastSuccessAt: view.lastSuccessAt,
    warningCodes: view.warningCodes,
  });

  const ensureHydrated = async (): Promise<void> => {
    await coordinator.ensureHydrated();
    if (collectorVersionChecked) return;
    collectorVersionChecked = true;
    const latest = coordinator.readLatest();
    if (
      latest.data != null &&
      latest.data.collectorVersion !== SESSION_COLLECTOR_VERSION
    ) {
      // Keep the old data readable, but force the next refresh path to collect
      // with the current registry/path/parser implementation. This is the
      // upgrade path for snapshots created before DSH support was complete.
      await coordinator.invalidate({ reason: "startup" });
    }
  };

  return {
    get refreshing() {
      return coordinator.refreshing;
    },
    ensureHydrated,
    readLatest: () => toView(coordinator.readLatest()),
    refreshNow: (signal) => coordinator.refreshNow(signal).then(toView),
    requestRefresh: (request) => coordinator.requestRefresh(request),
    invalidate: () => coordinator.invalidate(),
    clear: () => coordinator.clear(),
  };
}
