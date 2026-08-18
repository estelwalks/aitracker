import type { WslTopology } from "./wsl-topology.server.ts";
import { createSnapshotCoordinator } from "../snapshot-runtime/coordinator.ts";
import type { SnapshotEnvelope } from "../snapshot-runtime/contracts.ts";
import type { SnapshotRepository } from "../snapshot-runtime/contracts.ts";
import type { SnapshotRefreshPort } from "../snapshot-runtime/contracts.ts";
import { RUNTIME_POLICY } from "../../app/runtime-policy.generated.ts";

/**
 * P3-T3-04: WSL topology snapshot coordinator.
 *
 * Persists the enumerated distro/home topology so consumers never re-run
 * `wsl.exe` per page query. The snapshot is small and bounded; stale snapshots
 * stay readable (last-known-good) while a background refresh re-enumerates.
 */

export interface WslSnapshotRuntimeOptions {
  readonly repository: SnapshotRepository<WslTopology>;
  readonly requestRefresh?: SnapshotRefreshPort;
  readonly now?: () => number;
  /** Injectable enumerator for tests; defaults to `enumerateWslTopology`. */
  readonly enumerate?: (signal?: AbortSignal) => Promise<WslTopology>;
}

export interface WslSnapshotRuntime {
  ensureHydrated(): Promise<void>;
  readLatest(): {
    readonly data: WslTopology | null;
    readonly status: "empty" | "fresh" | "stale" | "refreshing" | "failed";
    readonly revision: string | null;
    readonly generatedAt: string | null;
    readonly lastSuccessAt: string | null;
    readonly warningCodes: readonly string[];
  };
  refreshNow(signal?: AbortSignal): Promise<{
    readonly data: WslTopology | null;
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

export function createWslSnapshotRuntime(
  options: WslSnapshotRuntimeOptions,
): WslSnapshotRuntime {
  const enumerate =
    options.enumerate ??
    (async (signal) => {
      const { enumerateWslTopology } = await import("./wsl-topology.server.ts");
      return enumerateWslTopology({ signal });
    });

  const coordinator = createSnapshotCoordinator<WslTopology>({
    repository: options.repository,
    requestRefresh: options.requestRefresh,
    now: options.now,
    freshForMs:
      RUNTIME_POLICY.snapshotPolicies.wslTopology.freshForMinutes * 60 * 1000,
    collect: async ({ signal }) => {
      const topology = await enumerate(signal);
      return {
        data: topology,
        sourceFingerprint: topology.enumeratedAt,
        scannedItems: topology.distros.length,
      };
    },
  });

  const toView = (
    view: ReturnType<typeof coordinator.readLatest>,
  ): ReturnType<WslSnapshotRuntime["readLatest"]> => ({
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
