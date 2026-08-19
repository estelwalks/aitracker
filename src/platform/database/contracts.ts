/**
 * Browser-safe SQLite database platform contracts (Story S-01).
 *
 * This module must stay free of `node:sqlite` and every other Node/runtime
 * import — even `import type` — so it can be consumed from renderer bundles
 * and boundary scripts. The synchronous port surface is intentionally the
 * smallest set the platform kernel needs; adapters in `infrastructure/` are
 * the only place the driver API may appear.
 */

/** Values that may be bound to a prepared statement parameter. */
export type SqliteBindValue = null | number | bigint | string | Uint8Array;

/** One result row. Column values are `unknown` because the driver may return
 * numbers, BigInts, strings, blobs or null depending on connection settings. */
export type SqliteRow = Readonly<Record<string, unknown>>;

export interface SqliteRunResult {
  /** Rows modified/inserted/deleted by the statement. */
  readonly changes: number | bigint;
  /** Most recent inserted rowid. */
  readonly lastInsertRowid: number | bigint;
}

/**
 * A compiled statement. Parameters are bound either anonymously (`?`) or by
 * prefixed name (`:name`, `@name`, `$name`); bare (unprefixed) named keys are
 * rejected by the strict adapters.
 */
export interface SqliteStatement {
  get(...anonymousParameters: SqliteBindValue[]): SqliteRow | undefined;
  get(
    namedParameters: Readonly<Record<string, SqliteBindValue>>,
    ...anonymousParameters: SqliteBindValue[]
  ): SqliteRow | undefined;
  all(...anonymousParameters: SqliteBindValue[]): SqliteRow[];
  all(
    namedParameters: Readonly<Record<string, SqliteBindValue>>,
    ...anonymousParameters: SqliteBindValue[]
  ): SqliteRow[];
  run(...anonymousParameters: SqliteBindValue[]): SqliteRunResult;
  run(
    namedParameters: Readonly<Record<string, SqliteBindValue>>,
    ...anonymousParameters: SqliteBindValue[]
  ): SqliteRunResult;
}

export interface Transaction {
  begin(): void;
  commit(): void;
  rollback(): void;
}

/**
 * Minimal synchronous database connection. Implementations are single-writer
 * (one connection per database path), owned by the Database Host; business
 * modules never see the driver type behind this port.
 */
export interface SqliteDatabasePort {
  readonly isOpen: boolean;
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  transaction(): Transaction;
  close(): void;
}

/**
 * `PRAGMA application_id` value that marks a file as a TrustTools platform
 * database (architecture §9-6: startup must validate `application_id`,
 * `user_version` and the migration checksums before a database is accepted).
 *
 * The integer is the big-endian ASCII of `TTDB` (`0x54544442`), which stays
 * inside SQLite's signed 32-bit range. Migration 0001 stamps it; open-time
 * validation accepts `0` (a fresh, not-yet-migrated database) **or** this
 * constant, and rejects every other value as `capability-mismatch`.
 */
export const TRUSTTOOLS_APPLICATION_ID = 0x54544442;

/** Why a backup was created (architecture §10.2). */
export type BackupKind = "daily" | "pre-migration";

/** Metadata written next to a completed online backup (architecture §10.2). */
export interface BackupManifest {
  /**
   * Backup purpose. `pre-migration` backups are the mandatory backups taken
   * before a schema migration and are retained longer than `daily` backups.
   * Manifests written before this field existed default to `daily`.
   */
  readonly kind: BackupKind;
  /** Schema version of the backed-up database. */
  readonly schemaVersion: number;
  /** Application version that produced the backup. */
  readonly appVersion: string;
  /** SQLite version used to create the backup. */
  readonly sqliteVersion: string;
  /** Size of the backup file in bytes. */
  readonly sizeBytes: number;
  /** SHA-256 of the backup file contents. */
  readonly sha256: string;
  /** Creation time in epoch milliseconds. */
  readonly createdAtMs: number;
}

/** A completed, verified backup artifact (implemented by backup.server.ts). */
export interface Backup {
  readonly path: string;
  readonly manifest: BackupManifest;
}

export type DatabaseErrorCode =
  | "access-denied"
  | "already-open"
  | "backup-failed"
  | "busy"
  | "capability-mismatch"
  | "constraint-violation"
  | "corrupt"
  | "integrity-check-failed"
  | "integer-overflow"
  | "invalid-argument"
  | "io-failure"
  | "journal-not-wal"
  | "migration-checksum"
  | "migration-reverted"
  | "not-found"
  | "not-open"
  | "sql-error"
  | "target-busy";

export type DatabaseOperation =
  | "open"
  | "close"
  | "read"
  | "write"
  | "transaction"
  | "migration"
  | "backup"
  | "integrity"
  | "probe";

/**
 * Public database errors deliberately omit filesystem paths so they are safe
 * to map to UI error codes and telemetry. The message is always
 * `<operation>:<code>`.
 */
export class DatabaseError extends Error {
  readonly name = "DatabaseError";
  private readonly explicitRetryable: boolean | undefined;

  constructor(
    readonly code: DatabaseErrorCode,
    readonly operation: DatabaseOperation,
    options?: { cause?: unknown; retryable?: boolean },
  ) {
    super(`${operation}:${code}`, options);
    this.explicitRetryable = options?.retryable;
    // `super(message, options)` stores `options.cause` verbatim on
    // `Error.cause`, so a raw filesystem/driver error would leak its message
    // and stack (which contain absolute paths) through `util.inspect` and into
    // any observability sink. Overwrite it with a path-free replacement.
    this.cause = sanitizeCause(options?.cause);
  }

  get retryable(): boolean {
    if (this.explicitRetryable !== undefined) return this.explicitRetryable;
    return this.cause instanceof DatabaseError
      ? this.cause.retryable
      : this.code === "busy" ||
          this.code === "io-failure" ||
          this.code === "target-busy";
  }
}

/**
 * Replaces a raw `Error` cause with a path-free stand-in that keeps only the
 * original `code`/`errno` (when present), dropping `message`, `stack` and any
 * path. A `DatabaseError` cause is already path-free by construction (its
 * message is `<operation>:<code>`) and carries the retryable chain, so it is
 * kept verbatim; non-`Error` causes are discarded.
 */
function sanitizeCause(cause: unknown): unknown {
  if (cause instanceof DatabaseError) return cause;
  if (!(cause instanceof Error)) return undefined;
  const source = cause as Error & { code?: unknown; errno?: unknown };
  const sanitized = new Error("cause sanitized");
  sanitized.stack = "Error: cause sanitized";
  if (source.code !== undefined) {
    (sanitized as Error & { code?: unknown }).code = source.code;
  }
  if (source.errno !== undefined) {
    (sanitized as Error & { errno?: unknown }).errno = source.errno;
  }
  return sanitized;
}
