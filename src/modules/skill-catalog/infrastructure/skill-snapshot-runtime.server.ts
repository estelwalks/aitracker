import type { SkillSnapshotData } from "./skill-snapshot.contracts.ts";
import { toSkillSnapshotData } from "./skill-snapshot.contracts.ts";
import { createSnapshotCoordinator } from "../../../platform/snapshot-runtime/coordinator.ts";
import type { SnapshotEnvelope } from "../../../platform/snapshot-runtime/contracts.ts";
import type { SnapshotRepository } from "../../../platform/snapshot-runtime/contracts.ts";
import type { SnapshotRefreshPort } from "../../../platform/snapshot-runtime/contracts.ts";
import { RUNTIME_POLICY } from "../../../app/runtime-policy.generated.ts";
import type { LocalUsageEvent } from "../../../lib/local-usage/types.ts";

/**
 * P3-T3-02: Skill snapshot coordinator.
 *
 * The legacy skill scanner is wrapped as a pure collector adapter. The
 * persisted snapshot holds only the sanitized projection (list, size, agent
 * ownership, update status) — never paths or detected roots. Pages read the
 * coordinator instead of re-scanning the skill directories.
 */

export interface SkillSnapshotRuntimeOptions {
  readonly repository: SnapshotRepository<SkillSnapshotData>;
  readonly requestRefresh?: SnapshotRefreshPort;
  readonly now?: () => number;
  /**
   * P2-18: production source of skill-call usage evidence. The usage snapshot
   * runtime persists a compacted DTO whose `details` are always empty, so the
   * composition captures the raw usage events (with `context.skills`) at
   * collection time and injects them here. Without a provider, `lastUsedAt`
   * stays null in production.
   */
  readonly usageEventsProvider?: () => LocalUsageEvent[];
  readonly collect?: (request: {
    readonly signal: AbortSignal;
    readonly previous: SnapshotEnvelope<SkillSnapshotData> | null;
  }) => Promise<{
    readonly data: SkillSnapshotData;
    readonly sourceFingerprint?: string | null;
    readonly scannedItems?: number;
    readonly reusedItems?: number;
  }>;
}

export interface SkillSnapshotRuntime {
  ensureHydrated(): Promise<void>;
  readLatest(): {
    readonly data: SkillSnapshotData | null;
    readonly status: "empty" | "fresh" | "stale" | "refreshing" | "failed";
    readonly revision: string | null;
    readonly generatedAt: string | null;
    readonly lastSuccessAt: string | null;
    readonly warningCodes: readonly string[];
  };
  refreshNow(signal?: AbortSignal): Promise<{
    readonly data: SkillSnapshotData | null;
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

export function createSkillSnapshotRuntime(
  options: SkillSnapshotRuntimeOptions,
): SkillSnapshotRuntime {
  const collect =
    options.collect ??
    (async ({ signal }) => {
      if (signal.aborted) throw new Error("cancelled");
      const { scanLocalSkills } =
        await import("../../../lib/local-skills/scanner.server.ts");
      // P5-T5-03: the signal flows into the scanner (directory walks stop on
      // cancellation). P2-18: structured skill-call evidence from the usage
      // pipeline feeds each skill's lastUsedAt in production.
      const snapshot = await scanLocalSkills({
        signal,
        usageEvents: options.usageEventsProvider?.() ?? [],
      });
      const data = toSkillSnapshotData(snapshot);
      return {
        data,
        sourceFingerprint: snapshot.fingerprint,
        scannedItems: snapshot.skills.length,
      };
    });

  const coordinator = createSnapshotCoordinator<SkillSnapshotData>({
    repository: options.repository,
    requestRefresh: options.requestRefresh,
    now: options.now,
    freshForMs:
      RUNTIME_POLICY.snapshotPolicies.skills.freshForMinutes * 60 * 1000,
    collect,
  });

  const toView = (
    view: ReturnType<typeof coordinator.readLatest>,
  ): ReturnType<SkillSnapshotRuntime["readLatest"]> => ({
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
