import type {
  SnapshotRepository,
  UsageCollectionRequest,
  UsageCollector,
  UsageHealthSummary,
  UsageModuleContract,
  UsageSnapshotDto,
} from "../contracts.ts";
import { err, ok, type Result } from "../../../shared/result.ts";

export type UsageSnapshotState = "fresh" | "stale" | "empty";

export type UsageApplicationErrorCode =
  | "errors.usage.snapshotReadFailed"
  | "errors.usage.snapshotSaveFailed"
  | "errors.usage.collectionFailed"
  | "errors.usage.cancelled";

export interface UsageClock {
  readonly now: () => number;
}

export interface GetUsageSnapshotRequest {
  /** Defaults to five minutes. A non-positive value means only same-timestamp data is fresh. */
  readonly maxAgeMs?: number;
}

export interface UsageSnapshotView {
  readonly snapshot?: UsageSnapshotDto;
  readonly state: UsageSnapshotState;
  readonly ageMs?: number;
}

export interface RefreshUsageOutcome extends UsageSnapshotView {
  readonly committed: boolean;
  readonly retainedPreviousSnapshot: boolean;
  readonly health?: UsageHealthSummary;
  readonly reason?: "budget-exhausted" | "collection-failed";
}

export interface UsageApplication {
  readonly contract: UsageModuleContract;
  readonly getUsageSnapshot: (
    request?: GetUsageSnapshotRequest,
  ) => Promise<Result<UsageSnapshotView, UsageApplicationErrorCode>>;
  readonly refreshUsage: (
    request?: UsageCollectionRequest,
  ) => Promise<Result<RefreshUsageOutcome, UsageApplicationErrorCode>>;
}

export interface UsageApplicationOptions {
  readonly collector: UsageCollector;
  readonly repository: SnapshotRepository;
  readonly clock?: UsageClock;
  readonly defaultMaxAgeMs?: number;
}

const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;

function snapshotView(
  snapshot: UsageSnapshotDto | undefined,
  now: number,
  maxAgeMs: number,
): UsageSnapshotView {
  if (snapshot == null || snapshot.mode === "empty") return { state: "empty" };
  const generatedAt = Date.parse(snapshot.generatedAt);
  if (!Number.isFinite(generatedAt)) return { snapshot, state: "stale" };
  const ageMs = Math.max(0, now - generatedAt);
  return {
    snapshot,
    state: ageMs <= Math.max(0, maxAgeMs) ? "fresh" : "stale",
    ageMs,
  };
}

function stableFailure(code: UsageApplicationErrorCode) {
  return err<UsageApplicationErrorCode>(code);
}

/** Framework-neutral application facade shared by manual refresh and scheduler adapters. */
export function createUsageApplication(
  options: UsageApplicationOptions,
): UsageApplication {
  const clock = options.clock ?? { now: Date.now };
  const defaultMaxAgeMs = options.defaultMaxAgeMs ?? DEFAULT_MAX_AGE_MS;

  return {
    contract: { module: "usage", schemaVersion: 1 },

    async getUsageSnapshot(request = {}) {
      let snapshot: UsageSnapshotDto | undefined;
      try {
        snapshot = await options.repository.load();
      } catch {
        return stableFailure("errors.usage.snapshotReadFailed");
      }
      return ok(
        snapshotView(
          snapshot,
          clock.now(),
          request.maxAgeMs ?? defaultMaxAgeMs,
        ),
      );
    },

    async refreshUsage(request = {}) {
      let previous: UsageSnapshotDto | undefined;
      try {
        previous = await options.repository.load();
      } catch {
        return stableFailure("errors.usage.snapshotReadFailed");
      }

      if (request.signal?.aborted)
        return stableFailure("errors.usage.cancelled");

      let collection;
      try {
        collection = await options.collector.collect(request);
      } catch {
        return ok({
          ...snapshotView(previous, clock.now(), defaultMaxAgeMs),
          committed: false,
          retainedPreviousSnapshot: previous != null,
          reason: "collection-failed",
        });
      }

      if (collection.cancelled) return stableFailure("errors.usage.cancelled");

      const retained =
        collection.budgetExhausted || collection.retainedPreviousSnapshot;
      if (retained) {
        return ok({
          ...snapshotView(
            previous ?? collection.snapshot,
            clock.now(),
            defaultMaxAgeMs,
          ),
          committed: false,
          retainedPreviousSnapshot:
            previous != null || collection.retainedPreviousSnapshot,
          health: collection.health,
          ...(collection.budgetExhausted
            ? { reason: "budget-exhausted" as const }
            : {}),
        });
      }

      try {
        await options.repository.save(collection.snapshot);
      } catch {
        return stableFailure("errors.usage.snapshotSaveFailed");
      }

      return ok({
        ...snapshotView(collection.snapshot, clock.now(), defaultMaxAgeMs),
        committed: true,
        retainedPreviousSnapshot: false,
        health: collection.health,
      });
    },
  };
}

export type { Result } from "../../../shared/result.ts";
