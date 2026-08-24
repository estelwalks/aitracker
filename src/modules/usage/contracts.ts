import type { LocalUsageSnapshot } from "../../lib/local-usage/types.ts";
import type {
  LocalTokenCounts,
  LocalUsageMeasurement,
  LocalUsageSource,
  LocalUsageToolCall,
} from "../../lib/local-usage/types.ts";

/** Browser-safe contracts owned by the usage feature. */
export const usageModuleId = "usage" as const;
export type UsageModuleId = typeof usageModuleId;
export interface UsageModuleContract {
  readonly module: UsageModuleId;
  readonly schemaVersion: 1;
}

/**
 * Compact, persisted usage bucket. A bucket is the smallest row required by
 * Dashboard/Widget/Insight: one local day + source + model + project and
 * evidence shape. `events` preserves the original call count, so consumers
 * never need the event-level fact table to calculate totals or rankings.
 */
export interface UsageAggregateBucket extends LocalTokenCounts {
  readonly date: string;
  readonly latestTimestamp: string;
  readonly source: LocalUsageSource;
  readonly model: string;
  readonly project: string;
  /** Stable installation-scoped HMAC identity on persisted reads. */
  readonly projectRefHash?: string;
  /** Server-resolved display value; never an absolute path. */
  readonly projectLabel?: string;
  /** Classification captured with the aggregate so restart cannot change it. */
  readonly projectKind?: UsageProjectKind;
  readonly measurement: LocalUsageMeasurement;
  readonly events: number;
  readonly context: {
    readonly textResponses: number;
    readonly toolCalls: number;
    readonly tools: readonly LocalUsageToolCall[];
    readonly skillCalls: number;
    readonly toolOutputCalls: number;
  };
  readonly evidence: {
    readonly textResponses: boolean;
    readonly toolCalls: boolean;
    readonly skillCalls: boolean;
    readonly toolOutputCalls: boolean;
    readonly reasoningTokens: boolean;
    readonly systemPromptTokens: boolean;
  };
}

export type UsageProjectKind = "workspace" | "quick-conversation" | "unknown";

/** Daily facts used to build Tracker boards without retaining raw events. */
export interface UsageTrackerBucket extends LocalTokenCounts {
  readonly dimension: "project" | "session" | "skill";
  readonly date: string;
  readonly source: LocalUsageSource;
  /** Raw server-only ref during collection, HMAC/safe key after hydration. */
  readonly identity: string;
  readonly label: string;
  readonly projectKind?: UsageProjectKind;
  readonly events: number;
  readonly calls: number;
}

/**
 * `aggregateBuckets` is optional at the scanner boundary for compatibility
 * with source adapters. The snapshot runtime normalizes every successful
 * collection before it reaches memory or SQLite; persisted reads always set
 * it and intentionally leave `details`/`recent` empty.
 */
export type UsageSnapshotDto = LocalUsageSnapshot & {
  readonly aggregateBuckets?: readonly UsageAggregateBucket[];
  readonly trackerBuckets?: readonly UsageTrackerBucket[];
};

export interface UsageScanBudget {
  /** Maximum number of files passed to each legacy source adapter. */
  readonly maxFilesPerSource?: number;
  /** Wall-clock budget for the collection operation. */
  readonly maxDurationMs?: number;
}

export interface UsageCollectionRequest {
  readonly signal?: AbortSignal;
  readonly budget?: UsageScanBudget;
  /** Optional test/desktop roots; paths stay inside the server adapter. */
  readonly scannerOptions?: {
    readonly homeDirectory?: string;
    readonly additionalHomeDirectories?: readonly string[];
    readonly claudeConfigDirectory?: string;
    readonly codexHomeDirectory?: string;
    readonly now?: Date;
    readonly lookbackDays?: number;
    readonly cacheDirectory?: string;
    readonly disablePersistentCache?: boolean;
    /** P3-T3-04: shared WSL topology injected by the refresh path. */
    readonly wslTopology?: import("../../lib/wsl-topology-types.ts").WslTopologyInput;
  };
}

export type UsageHealthStatus = "healthy" | "degraded" | "unavailable";

export interface UsageHealthSummary {
  readonly status: UsageHealthStatus;
  readonly sourceCount: number;
  readonly availableSourceCount: number;
  readonly failedSourceCount: number;
  readonly diagnostics: readonly string[];
}

export interface UsageCollectionResult {
  readonly snapshot: UsageSnapshotDto;
  readonly health: UsageHealthSummary;
  readonly durationMs: number;
  readonly budgetExhausted: boolean;
  readonly cancelled: boolean;
  readonly retainedPreviousSnapshot: boolean;
}

export interface UsageCollector {
  collect(request?: UsageCollectionRequest): Promise<UsageCollectionResult>;
}

/** Renderer-safe read model for the Token burn leaderboard. */
export interface TrackerReadModel {
  /** Null when the usage scanner has no real snapshot to report. */
  readonly generatedAt: string | null;
  readonly boards: Readonly<
    Record<
      import("./application/tracker.ts").RoastDimension,
      import("./application/tracker.ts").TrackerBoard
    >
  >;
  readonly totals: { tokens: number; events: number; entries: number };
}

export interface SnapshotRepository {
  load(): Promise<UsageSnapshotDto | undefined>;
  save(snapshot: UsageSnapshotDto): Promise<void>;
}

/** Browser-safe view of the unified Usage snapshot runtime (P2). */
export interface UsageSnapshotReadView {
  readonly data: UsageSnapshotDto | null;
  readonly status: "empty" | "fresh" | "stale" | "refreshing" | "failed";
  readonly revision: string | null;
  readonly generatedAt: string | null;
  readonly ageMs: number | null;
  readonly lastSuccessAt: string | null;
  readonly lastAttemptAt: string | null;
  readonly warningCodes: readonly string[];
  readonly staleReadable: boolean;
}

/** Framework-neutral facade of the Usage snapshot coordinator (P2). */
export interface UsageSnapshotRuntime {
  ensureHydrated(): Promise<void>;
  readLatest(): UsageSnapshotReadView;
  refreshNow(signal?: AbortSignal): Promise<UsageSnapshotReadView>;
  requestRefresh(request: {
    reason: "startup" | "schedule" | "manual" | "event" | "empty" | "stale";
    signal?: AbortSignal;
  }): Promise<void>;
  invalidate(): Promise<void>;
  clear(): Promise<void>;
  readonly refreshing: boolean;
}
