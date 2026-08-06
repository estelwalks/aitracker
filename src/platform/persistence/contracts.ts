/** Framework-agnostic persistence contracts. */

export interface Clock {
  now(): Date;
}

export interface AtomicJsonStore<T> {
  read(): Promise<AtomicJsonReadResult<T>>;
  write(value: T): Promise<void>;
}

export interface AtomicJsonReadResult<T> {
  value: T;
  source: "stored" | "default" | "migrated" | "recovered-corrupt";
  schemaVersion: number;
  corruptBackupCreated?: boolean;
}

export interface JsonSchema<T> {
  currentVersion: number;
  parse(value: unknown): T;
  migrations?: readonly JsonMigration[];
}

/** A migration always receives the previous document's `data` payload. */
export interface JsonMigration {
  fromVersion: number;
  toVersion: number;
  migrate(value: unknown): unknown;
}

export interface FileLock {
  acquire(): Promise<FileLockLease>;
}

export interface FileLockLease {
  release(): Promise<void>;
}

export type PersistenceErrorCode =
  | "access-denied"
  | "already-exists"
  | "invalid-document"
  | "io-failure"
  | "lock-conflict"
  | "migration-failed"
  | "not-found"
  | "target-busy";

/**
 * Public errors deliberately omit filesystem paths so they are safe to map to
 * UI error codes and telemetry.
 */
export class PersistenceError extends Error {
  readonly name = "PersistenceError";
  private readonly explicitRetryable: boolean | undefined;

  constructor(
    readonly code: PersistenceErrorCode,
    readonly operation: "read" | "write" | "lock" | "migration" | "backup",
    options?: { cause?: unknown; retryable?: boolean },
  ) {
    super(`${operation}:${code}`, options);
    this.explicitRetryable = options?.retryable;
  }

  get retryable(): boolean {
    if (this.explicitRetryable !== undefined) return this.explicitRetryable;
    return this.cause instanceof PersistenceError
      ? this.cause.retryable
      : this.code === "target-busy" || this.code === "io-failure";
  }
}
