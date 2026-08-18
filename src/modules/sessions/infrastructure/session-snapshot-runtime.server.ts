import type { SessionSnapshotData } from "./session-snapshot.contracts.ts";
import { buildSessionDensity } from "./session-snapshot.contracts.ts";
import { createSnapshotCoordinator } from "../../../platform/snapshot-runtime/coordinator.ts";
import type { SnapshotEnvelope } from "../../../platform/snapshot-runtime/contracts.ts";
import type { SnapshotRepository } from "../../../platform/snapshot-runtime/contracts.ts";
import type { SnapshotRefreshPort } from "../../../platform/snapshot-runtime/contracts.ts";
import { RUNTIME_POLICY } from "../../../app/runtime-policy.generated.ts";

/**
 * P3-T3-01: Session snapshot coordinator.
 *
 * The legacy session scanner is wrapped as a pure collector adapter — it
 * receives an AbortSignal, returns browser-safe summaries plus pre-aggregated
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
    reason: "startup" | "schedule" | "manual" | "event" | "empty";
    signal?: AbortSignal;
  }): Promise<void>;
  invalidate(): Promise<void>;
  clear(): Promise<void>;
  readonly refreshing: boolean;
}

export function createSessionSnapshotRuntime(
  options: SessionSnapshotRuntimeOptions,
): SessionSnapshotRuntime {
  const collect =
    options.collect ??
    (async ({ signal }) => {
      const { createLegacySessionRepository } =
        await import("./legacy-session-adapter.server.ts");
      const repository = createLegacySessionRepository();
      const sessions = await repository.list(signal);
      return {
        data: {
          generatedAt: new Date().toISOString(),
          sessions,
          density: buildSessionDensity(sessions),
        },
        sourceFingerprint: new Date().toISOString(),
        scannedItems: sessions.length,
      };
    });

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

  return {
    get refreshing() {
      return coordinator.refreshing;
    },
    ensureHydrated: () => coordinator.ensureHydrated(),
    readLatest: () => toView(coordinator.readLatest()),
    refreshNow: (signal) => coordinator.refreshNow(signal).then(toView),
    requestRefresh: (request) => coordinator.requestRefresh(request),
    invalidate: () => coordinator.invalidate(),
    clear: () => coordinator.clear(),
  };
}
