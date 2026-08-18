import type { InstallationSnapshotData } from "./installation-snapshot.contracts.ts";
import { displayPaths } from "./installation-snapshot.contracts.ts";
import { createSnapshotCoordinator } from "../../platform/snapshot-runtime/coordinator.ts";
import type { SnapshotEnvelope } from "../../platform/snapshot-runtime/contracts.ts";
import type { SnapshotRepository } from "../../platform/snapshot-runtime/contracts.ts";
import type { SnapshotRefreshPort } from "../../platform/snapshot-runtime/contracts.ts";
import { RUNTIME_POLICY } from "../../app/runtime-policy.generated.ts";

/**
 * P3-T3-03: Installation snapshot coordinator.
 *
 * Probes tool installation roots + executable availability once per refresh
 * and shares the facts with Usage, Skill and Sources. The persisted snapshot
 * holds only `~/`-relative display paths — absolute probe paths never leave
 * the collector.
 */

export interface InstallationSnapshotRuntimeOptions {
  readonly repository: SnapshotRepository<InstallationSnapshotData>;
  readonly requestRefresh?: SnapshotRefreshPort;
  readonly now?: () => number;
  readonly homeDirectory?: () => string;
  readonly collect?: (request: {
    readonly signal: AbortSignal;
    readonly previous: SnapshotEnvelope<InstallationSnapshotData> | null;
  }) => Promise<{
    readonly data: InstallationSnapshotData;
    readonly sourceFingerprint?: string | null;
    readonly scannedItems?: number;
    readonly reusedItems?: number;
  }>;
}

export interface InstallationSnapshotRuntime {
  ensureHydrated(): Promise<void>;
  readLatest(): {
    readonly data: InstallationSnapshotData | null;
    readonly status: "empty" | "fresh" | "stale" | "refreshing" | "failed";
    readonly revision: string | null;
    readonly generatedAt: string | null;
    readonly lastSuccessAt: string | null;
    readonly warningCodes: readonly string[];
  };
  refreshNow(signal?: AbortSignal): Promise<{
    readonly data: InstallationSnapshotData | null;
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

export function createInstallationSnapshotRuntime(
  options: InstallationSnapshotRuntimeOptions,
): InstallationSnapshotRuntime {
  const collect =
    options.collect ??
    (async ({ signal }) => {
      if (signal.aborted) throw new Error("cancelled");
      const { homedir } = await import("node:os");
      const { AI_TOOLS } = await import("../../lib/tools/catalog.ts");
      const { detectToolInstallations } =
        await import("../../lib/tools/detection.server.ts");
      const homeDirectory = options.homeDirectory?.() ?? homedir();
      const facts = await detectToolInstallations(AI_TOOLS, homeDirectory);
      return {
        data: {
          generatedAt: new Date().toISOString(),
          facts: facts.map((fact) => ({
            id: fact.id,
            installed: fact.installed,
            paths: displayPaths(fact.detectedPaths, homeDirectory),
            executableFound: fact.detectedPaths.length > 0,
          })),
        },
        sourceFingerprint: homeDirectory,
        scannedItems: facts.length,
      };
    });

  const coordinator = createSnapshotCoordinator<InstallationSnapshotData>({
    repository: options.repository,
    requestRefresh: options.requestRefresh,
    now: options.now,
    freshForMs:
      RUNTIME_POLICY.snapshotPolicies.toolInstallations.freshForMinutes *
      60 *
      1000,
    collect,
  });

  const toView = (
    view: ReturnType<typeof coordinator.readLatest>,
  ): ReturnType<InstallationSnapshotRuntime["readLatest"]> => ({
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
