/**
 * Database Host (Story S-01, T-01-03): single-connection lifecycle.
 *
 * Server-only. Owns one writable connection per *canonical* database path
 * (in-process singleton — see `normalizeDatabasePath`: `realpath` plus Windows
 * case folding, so no spelling of the same file can obtain a second writer),
 * runs the capability probe before opening, and applies + asserts the required
 * PRAGMAs. The Host holds only the adapter and the probe results — it contains
 * zero business SQL. On any assertion failure the connection is closed and a
 * stable error code is returned; journal semantics are never silently
 * downgraded and the database is never destructively rebuilt.
 */
import { existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import {
  DatabaseError,
  AITRACKER_APPLICATION_ID,
  type SqliteDatabasePort,
  type SqliteRow,
  type SqliteStatement,
  type Transaction,
} from "./contracts.ts";
import {
  evaluateCapabilities,
  probeWalCapability,
  type CapabilityFailureReason,
  type CapabilityProbeResult,
  type RuntimeVersions,
  type RuntimeVersionsProvider,
} from "./capability-probe.server.ts";
import {
  bigintToSafeNumber,
  getUnderlyingDatabaseSync,
  NodeSqliteDatabase,
} from "./infrastructure/node-sqlite-database.server.ts";
import { assertMigrationState } from "./migration-runner.server.ts";
import {
  ensurePrivateDirectory,
  ensurePrivateFile,
} from "./file-permissions.server.ts";
import {
  acquireWriterOwnership,
  type WriterOwnership,
} from "./writer-ownership.server.ts";

const OPEN_HOSTS = new Map<string, DatabaseHost>();

/** The only accepted non-file path. */
const MEMORY_PATH = ":memory:";

export interface DatabaseHostOptions {
  /** Database file path or `":memory:"` for a throwaway in-memory database.
   * An empty string is rejected with `invalid-argument`. */
  readonly path: string;
  /** Injectable runtime version source (fakeable in tests). */
  readonly versionsProvider: RuntimeVersionsProvider;
  /**
   * Directory used for the WAL capability probe. Defaults to the OS temp
   * directory, so no probe artifact ever lands next to the data file
   * (review finding P2-9); injectable for tests and for callers that need a
   * specific filesystem to probe.
   */
  readonly probeDirectory?: string;
  /** Injectable adapter factory (used by tests to simulate PRAGMA failures). */
  readonly adapterFactory?: (path: string) => SqliteDatabasePort;
}

/**
 * Single-writer database connection with a strict open protocol. Implements
 * `SqliteDatabasePort` by delegating to the underlying adapter so business
 * repositories can depend on the port type.
 */
export class DatabaseHost implements SqliteDatabasePort {
  private constructor(
    /** Canonical path this host is registered under (`normalizeDatabasePath`). */
    readonly path: string,
    /** Versions recorded and evaluated at open time. */
    readonly runtimeVersions: RuntimeVersions,
    private readonly connection: SqliteDatabasePort,
    private readonly ownership?: WriterOwnership,
  ) {}

  private activeBorrows = 0;

  static open(options: DatabaseHostOptions): DatabaseHost {
    // `realpath()` can only canonicalize a chain that exists, and both the WAL
    // probe and the connection need the directory anyway. Creating it first
    // keeps a missing data directory from surfacing as a raw ENOENT and lets
    // the singleton key be a true canonical path.
    const requested = resolveRequestedPath(options.path);
    if (requested !== MEMORY_PATH) ensureDirectory(dirname(requested));
    const path = normalizeDatabasePath(requested);
    if (OPEN_HOSTS.has(path)) {
      throw new DatabaseError("already-open", "open");
    }

    const versions = options.versionsProvider.getVersions();
    const probeDirectory = options.probeDirectory ?? tmpdir();
    const probe = runWalProbe(probeDirectory);
    const evaluation = evaluateCapabilities(versions, probe);
    if (!evaluation.supported) {
      throw new DatabaseError(
        capabilityFailureCode(evaluation.failureReason),
        "open",
        {
          cause: evaluation.failureReason,
          retryable: false,
        },
      );
    }

    let ownership: WriterOwnership | undefined;
    let connection: SqliteDatabasePort;
    let databaseExistedAtConnectionOpen = false;
    try {
      if (path !== MEMORY_PATH) ownership = acquireWriterOwnership(path);
      databaseExistedAtConnectionOpen =
        path !== MEMORY_PATH && existsSync(path);
      connection = options.adapterFactory
        ? options.adapterFactory(path)
        : new NodeSqliteDatabase({ path });
    } catch (error) {
      ownership?.release();
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError("io-failure", "open", { cause: error });
    }

    try {
      applyAndAssertPragmas(
        connection,
        path === MEMORY_PATH,
        databaseExistedAtConnectionOpen,
      );
      if (path !== MEMORY_PATH) protectDatabaseFaultGroup(path);
    } catch (error) {
      if (closeBestEffort(connection)) ownership?.release();
      if (error instanceof DatabaseError) throw error;
      if (error instanceof PragmaAssertionFailure) {
        throw new DatabaseError(error.code, "open", { retryable: false });
      }
      throw new DatabaseError("capability-mismatch", "open", { cause: error });
    }

    const host = new DatabaseHost(path, versions, connection, ownership);
    OPEN_HOSTS.set(path, host);
    return host;
  }

  get isOpen(): boolean {
    return this.connection.isOpen;
  }

  prepare(sql: string): SqliteStatement {
    this.assertOpen("read");
    return this.connection.prepare(sql);
  }

  exec(sql: string): void {
    this.assertOpen("write");
    this.connection.exec(sql);
  }

  transaction(): Transaction {
    this.assertOpen("transaction");
    return this.connection.transaction();
  }

  /**
   * Platform-internal, narrow access to the driver handle this Host owns.
   *
   * The online backup API needs a live `DatabaseSync`, and opening a *second*
   * writable connection to the same file would break the single-writer contract
   * (architecture §3.2). Callers therefore borrow the Host's own connection for
   * the duration of `fn` instead of opening their own. Only `platform/database`
   * server modules may use this; the handle must not be retained past `fn`, and
   * `DatabaseSync` still never crosses `SqliteDatabasePort`.
   */
  withUnderlyingConnection<T>(fn: (database: DatabaseSync) => T): T {
    this.assertOpen("backup");
    this.activeBorrows += 1;
    try {
      const result = fn(getUnderlyingDatabaseSync(this.connection));
      if (isPromiseLike(result)) {
        return Promise.resolve(result).finally(() => {
          this.activeBorrows -= 1;
        }) as T;
      }
      this.activeBorrows -= 1;
      return result;
    } catch (error) {
      this.activeBorrows -= 1;
      throw error;
    }
  }

  /**
   * Runs `PRAGMA wal_checkpoint(PASSIVE|TRUNCATE)` on the Host's own connection
   * and returns the three reported columns. `passive` never blocks active
   * readers; `truncate` also rewrites the WAL down to zero frames. Business
   * code should call this instead of issuing `PRAGMA wal_checkpoint` through
   * `exec` (review finding P2-8).
   */
  checkpoint(mode: "passive" | "truncate"): {
    busy: boolean;
    logFrames: number;
    checkpointedFrames: number;
  } {
    this.assertOpen("read");
    const sql =
      mode === "truncate"
        ? "PRAGMA wal_checkpoint(TRUNCATE)"
        : "PRAGMA wal_checkpoint(PASSIVE)";
    const row = this.connection.prepare(sql).get();
    if (row === undefined) {
      throw new DatabaseError("sql-error", "read");
    }
    return {
      busy: checkpointInteger(row, "busy") !== 0,
      logFrames: checkpointInteger(row, "log"),
      checkpointedFrames: checkpointInteger(row, "checkpointed"),
    };
  }

  /** Reclaims free pages after a destructive cache cleanup. */
  vacuum(): void {
    this.assertOpen("write");
    this.connection.exec("VACUUM");
  }

  /** Closes the connection and releases the singleton registration. */
  close(): void {
    if (this.activeBorrows > 0) {
      throw new DatabaseError("busy", "close");
    }
    if (!this.connection.isOpen) {
      OPEN_HOSTS.delete(this.path);
      this.ownership?.release();
      return;
    }
    try {
      // Best-effort WAL truncation before close: a file database should not
      // leave a large -wal behind for the next open to replay. `:memory:` and
      // already-closed connections are ignored.
      this.connection.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
    } catch {
      // Best effort; the close below is the real teardown.
    }
    this.connection.close();
    OPEN_HOSTS.delete(this.path);
    this.ownership?.release();
  }

  /** A closed Host is a lifecycle mistake, reported as `not-open`. */
  private assertOpen(operation: "read" | "write" | "transaction" | "backup") {
    if (!this.connection.isOpen) {
      throw new DatabaseError("not-open", operation, { retryable: false });
    }
  }
}

/**
 * Canonical registry key **and** public path of a Host.
 *
 * Two different spellings of the same file must never yield two writable
 * connections, so the requested path is resolved to an absolute path, then
 * canonicalized with `realpath` (which collapses `..`, symlinks, junctions and
 * — on Windows — 8.3 short names), and finally case-folded on Windows, whose
 * filesystem is case-insensitive. `platform.db` and `PLATFORM.DB` therefore map
 * to the same key. An empty path is a caller bug and is rejected instead of
 * being silently redirected to a throwaway in-memory database.
 */
function normalizeDatabasePath(path: string): string {
  const requested = resolveRequestedPath(path);
  if (requested === MEMORY_PATH) return MEMORY_PATH;
  return caseFold(canonicalize(requested));
}

function resolveRequestedPath(path: string): string {
  if (typeof path !== "string" || path.trim() === "") {
    throw new DatabaseError("invalid-argument", "open", { retryable: false });
  }
  return path === MEMORY_PATH ? MEMORY_PATH : resolve(path);
}

/**
 * `realpath` of an absolute path. A database file that does not exist yet
 * cannot be canonicalized directly, so its (already created) parent chain is
 * canonicalized and the file name is re-attached verbatim.
 */
function canonicalize(absolute: string): string {
  try {
    return realpathSync.native(absolute);
  } catch {
    try {
      return join(realpathSync.native(dirname(absolute)), basename(absolute));
    } catch {
      // Neither the file nor its parent can be canonicalized; the resolved path
      // is still a correct key and the open attempt below reports the real
      // filesystem error.
      return absolute;
    }
  }
}

function caseFold(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

/**
 * Creates the database directory chain when it is missing. A first run on a
 * fresh machine must not fail just because `~/.aitracker/data` does not exist
 * yet, and a genuine filesystem failure must still be a stable error code.
 */
function ensureDirectory(directory: string): void {
  try {
    ensurePrivateDirectory(directory);
  } catch (error) {
    throw new DatabaseError("io-failure", "open", { cause: error });
  }
}

/** Runs the WAL probe, mapping raw filesystem failures to `io-failure`. */
function runWalProbe(directory: string): CapabilityProbeResult {
  try {
    return probeWalCapability(directory);
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    throw new DatabaseError("io-failure", "open", { cause: error });
  }
}

/**
 * Applies and asserts the required PRAGMAs. `journal_mode` is the only one
 * that differs for `:memory:` databases (it reports `memory`, not `wal`);
 * every other assertion must hold on any database kind.
 */
function applyAndAssertPragmas(
  connection: SqliteDatabasePort,
  isMemory: boolean,
  existedBeforeOpen: boolean,
): void {
  const journalMode = normalizePragmaValue(
    firstValue(connection.prepare("PRAGMA journal_mode=WAL").get()),
  );
  const expectedJournal = isMemory ? "memory" : "wal";
  if (journalMode !== expectedJournal) {
    throw new PragmaAssertionFailure("journal-not-wal", journalMode);
  }
  applyAndAssert(connection, "PRAGMA synchronous=FULL", "PRAGMA synchronous", [
    "2",
    "full",
  ]);
  applyAndAssert(
    connection,
    "PRAGMA wal_autocheckpoint=1000",
    "PRAGMA wal_autocheckpoint",
    ["1000"],
  );
  applyAndAssert(connection, "PRAGMA foreign_keys=ON", "PRAGMA foreign_keys", [
    "1",
    "on",
  ]);
  applyAndAssert(
    connection,
    "PRAGMA busy_timeout=5000",
    "PRAGMA busy_timeout",
    ["5000"],
  );
  applyAndAssert(
    connection,
    "PRAGMA trusted_schema=OFF",
    "PRAGMA trusted_schema",
    ["0", "off"],
  );
  if (assertApplicationId(connection, isMemory || !existedBeforeOpen)) {
    assertMigrationState(connection);
  }
}

function applyAndAssert(
  connection: SqliteDatabasePort,
  applySql: string,
  readSql: string,
  accepted: readonly string[],
): void {
  connection.exec(applySql);
  const actual = normalizePragmaValue(
    firstValue(connection.prepare(readSql).get()),
  );
  if (!accepted.includes(actual)) {
    throw new PragmaAssertionFailure("capability-mismatch", actual);
  }
}

class PragmaAssertionFailure extends Error {
  constructor(
    readonly code: "journal-not-wal" | "capability-mismatch",
    readonly actual: string,
  ) {
    super(`pragma assertion failed for ${code} (actual: ${actual})`);
  }
}

/**
 * Maps a capability-probe failure reason to the stable open error code
 * (review finding P2-10): a filesystem that cannot settle on WAL is
 * `journal-not-wal`, while an unsupported SQLite version is
 * `capability-mismatch`.
 */
export function capabilityFailureCode(
  reason: CapabilityFailureReason | null,
): "journal-not-wal" | "capability-mismatch" {
  return reason === "wal-unavailable"
    ? "journal-not-wal"
    : "capability-mismatch";
}

/**
 * `application_id` must already be `0` (fresh, not yet migrated) or the
 * AITracker constant; any other value means the file belongs to a different
 * application and must not be opened (architecture §9-6 database-substitution
 * guard). Migration 0001 stamps the constant, so a migrated database always
 * reads back the constant.
 */
function assertApplicationId(
  connection: SqliteDatabasePort,
  createdByThisOpen: boolean,
): boolean {
  const actual = normalizePragmaValue(
    firstValue(connection.prepare("PRAGMA application_id").get()),
  );
  if (actual === String(AITRACKER_APPLICATION_ID)) return true;
  if (actual !== "0") {
    throw new PragmaAssertionFailure("capability-mismatch", actual);
  }
  if (createdByThisOpen) return false;

  const userVersion = normalizePragmaValue(
    firstValue(connection.prepare("PRAGMA user_version").get()),
  );
  const userObject = connection
    .prepare(
      "SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND type IN ('table', 'index', 'view', 'trigger') LIMIT 1",
    )
    .get();
  if (userVersion !== "0" || userObject !== undefined) {
    throw new PragmaAssertionFailure("capability-mismatch", actual);
  }
  return false;
}

/** One integer column of a single-row PRAGMA result, read as a safe number. */
function checkpointInteger(row: SqliteRow, column: string): number {
  const value = row[column];
  if (typeof value === "bigint") return bigintToSafeNumber(value);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new DatabaseError("sql-error", "read");
}

function closeBestEffort(connection: SqliteDatabasePort): boolean {
  try {
    if (connection.isOpen) connection.close();
    return !connection.isOpen;
  } catch {
    return false;
  }
}

function protectDatabaseFaultGroup(path: string): void {
  ensurePrivateFile(path);
  for (const sibling of [`${path}-wal`, `${path}-shm`]) {
    if (existsSync(sibling)) ensurePrivateFile(sibling);
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/** First column of a pragma result row, regardless of column name. */
function firstValue(row: SqliteRow | undefined): unknown {
  if (row === undefined) return undefined;
  const values = Object.values(row);
  return values.length === 0 ? undefined : values[0];
}

/** Normalizes pragma readbacks (BigInt, number, text) to a comparable string. */
export function normalizePragmaValue(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value.toLowerCase();
  if (value === null || value === undefined) return "";
  return String(value);
}
