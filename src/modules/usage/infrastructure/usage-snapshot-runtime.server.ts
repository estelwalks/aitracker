import type {
  UsageSnapshotDto,
  UsageSnapshotReadView,
  UsageSnapshotRuntime,
} from "../contracts.ts";
import { createSnapshotCoordinator } from "../../../platform/snapshot-runtime/coordinator.ts";
import type { SnapshotEnvelope } from "../../../platform/snapshot-runtime/contracts.ts";
import type { SnapshotRepository } from "../../../platform/snapshot-runtime/contracts.ts";
import type { SnapshotRefreshPort } from "../../../platform/snapshot-runtime/contracts.ts";
import { RUNTIME_POLICY } from "../../../app/runtime-policy.generated.ts";

/**
 * P2-T2-06: Usage snapshot coordinator.
 *
 * The collector is the usage scanner wrapped as a pure adapter (an
 * external-source read-only collection adapter) — it receives an AbortSignal, returns the sanitized snapshot, and never writes. The
 * coordinator commits once per refresh and keeps last-known-good. Raw events
 * stay server-only (`details`/`recent` are present in the persisted snapshot
 * but only page-specific projectors expose them).
 */

export interface UsageSnapshotRuntimeOptions {
  readonly repository: SnapshotRepository<UsageSnapshotDto>;
  /** Task-runtime port for requestRefresh/invalidate. */
  readonly requestRefresh?: SnapshotRefreshPort;
  readonly now?: () => number;
  /** Injectable collector for tests (defaults to the usage scanner). */
  readonly collect?: (request: {
    readonly signal: AbortSignal;
    readonly previous: SnapshotEnvelope<UsageSnapshotDto> | null;
  }) => Promise<{
    readonly data: UsageSnapshotDto;
    readonly sourceFingerprint?: string | null;
    readonly scannedItems?: number;
    readonly reusedItems?: number;
  }>;
}

function toReadView(
  view: ReturnType<
    ReturnType<typeof createSnapshotCoordinator<UsageSnapshotDto>>["readLatest"]
  >,
): UsageSnapshotReadView {
  return view;
}

export function createUsageSnapshotRuntime(
  options: UsageSnapshotRuntimeOptions,
): UsageSnapshotRuntime {
  const collect =
    options.collect ??
    (async ({ signal, previous }) => {
      const { createUsageCollector } =
        await import("./usage-collector.server.ts");
      const collector = createUsageCollector();
      const result = await collector.collect({
        signal,
        budget: {
          maxDurationMs: RUNTIME_POLICY.snapshotPolicies.usage.timeoutMs,
        },
      });
      if (result.cancelled) throw new Error("usage:cancelled");
      if (result.budgetExhausted && previous?.data != null) {
        // Budget exhausted: keep last-known-good without a failed commit.
        return {
          data: previous.data,
          sourceFingerprint: previous.sourceFingerprint ?? undefined,
          scannedItems: 0,
          reusedItems: 0,
        };
      }
      if (result.retainedPreviousSnapshot && previous?.data != null) {
        return {
          data: previous.data,
          sourceFingerprint: previous.sourceFingerprint ?? undefined,
        };
      }
      return {
        data: result.snapshot,
        sourceFingerprint: result.snapshot.generatedAt,
        scannedItems: result.snapshot.events,
      };
    });

  const coordinator = createSnapshotCoordinator<UsageSnapshotDto>({
    repository: options.repository,
    requestRefresh: options.requestRefresh,
    now: options.now,
    freshForMs:
      RUNTIME_POLICY.snapshotPolicies.usage.freshForMinutes * 60 * 1000,
    collect,
  });

  return {
    get refreshing() {
      return coordinator.refreshing;
    },
    ensureHydrated: () => coordinator.ensureHydrated(),
    readLatest: () => toReadView(coordinator.readLatest()),
    refreshNow: (signal) => coordinator.refreshNow(signal).then(toReadView),
    requestRefresh: (request) => coordinator.requestRefresh(request),
    invalidate: () => coordinator.invalidate(),
    clear: () => coordinator.clear(),
  };
}
