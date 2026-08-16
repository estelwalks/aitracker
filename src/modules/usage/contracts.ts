import type { LocalUsageSnapshot } from "../../lib/local-usage/types.ts";

/** Browser-safe contracts owned by the usage feature. */
export const usageModuleId = "usage" as const;
export type UsageModuleId = typeof usageModuleId;
export interface UsageModuleContract {
  readonly module: UsageModuleId;
  readonly schemaVersion: 1;
}

export type UsageSnapshotDto = LocalUsageSnapshot;

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
