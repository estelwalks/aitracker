/**
 * P2-T2-01: unified snapshot runtime contracts.
 *
 * Every domain snapshot (Usage, Session, Skill, Installation, WSL, Exchange
 * rates, …) uses the same envelope so pages always read the most recent
 * completed snapshot, scanners run in the background, and failures keep the
 * last-known-good. Query paths only read the coordinator; refresh requests go
 * through the task runtime.
 */

export type SnapshotStatus =
  "empty" | "fresh" | "stale" | "refreshing" | "failed";

export interface SnapshotDiagnostics {
  readonly lastAttemptAt: string | null;
  readonly lastSuccessAt: string | null;
  readonly durationMs?: number;
  readonly scannedItems?: number;
  readonly reusedItems?: number;
  readonly warningCodes: readonly string[];
}

/** The persisted + in-memory envelope shared by all snapshot domains. */
export interface SnapshotEnvelope<T> {
  readonly schemaVersion: number;
  /** Stable revision of the snapshot data (opaque; changes on commit). */
  readonly revision: string;
  readonly generatedAt: string | null;
  /** Optional fingerprint of the source inputs (for incremental reuse). */
  readonly sourceFingerprint: string | null;
  readonly status: SnapshotStatus;
  readonly data: T | null;
  readonly diagnostics: SnapshotDiagnostics;
}

export interface SnapshotHydrateResult<T> {
  readonly envelope: SnapshotEnvelope<T>;
  /** "stored" | "default" | "migrated" | "recovered-corrupt" */
  readonly source: string;
  readonly schemaVersion: number;
  readonly corruptBackupCreated?: boolean;
}

/** Persistence port for one domain snapshot. */
export interface SnapshotRepository<T> {
  /** Reads the latest completed snapshot; never triggers a refresh. */
  load(): Promise<SnapshotHydrateResult<T>>;
  /** Commits a completed snapshot. */
  save(envelope: SnapshotEnvelope<T>): Promise<void>;
  /** Clears stale/invalid snapshot state (used by invalidate flows). */
  clear(): Promise<void>;
}

export interface SnapshotRefreshRequest {
  /** Why the refresh was requested (startup/schedule/manual/event/empty/stale). */
  readonly reason:
    "startup" | "schedule" | "manual" | "event" | "empty" | "stale";
  readonly signal?: AbortSignal;
}

/** Refresh port implemented by the task runtime (single-flight, budget). */
export interface SnapshotRefreshPort {
  requestRefresh(request: SnapshotRefreshRequest): Promise<unknown>;
}

export interface SnapshotRuntimeOptions<T> {
  readonly repository: SnapshotRepository<T>;
  /** Called when the domain snapshot must be rebuilt (collector adapter). */
  readonly collect: (request: {
    readonly signal: AbortSignal;
    readonly previous: SnapshotEnvelope<T> | null;
  }) => Promise<{
    readonly data: T;
    readonly sourceFingerprint?: string | null;
    readonly scannedItems?: number;
    readonly reusedItems?: number;
    /**
     * True when `data` is the previous last-known-good reused unchanged
     * (budget exhaustion / degraded health, P2-3): the commit must preserve
     * the original `generatedAt` and report `stale` instead of re-stamping a
     * fresh timestamp on data that was never actually collected.
     */
    readonly staleRefreshed?: boolean;
  }>;
  /** Optional task-runtime port; requestRefresh/invalidate delegate to it. */
  readonly requestRefresh?: SnapshotRefreshPort;
  /** Clock in milliseconds (injectable). */
  readonly now?: () => number;
  /** Freshness window in milliseconds (from runtime policy). */
  readonly freshForMs: number;
  readonly createRevision?: () => string;
  readonly createId?: () => string;
}
