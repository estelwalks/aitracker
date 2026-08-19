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
import { mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import {
  DatabaseError,
  type SqliteDatabasePort,
  type SqliteRow,
  type SqliteStatement,
  type Transaction,
} from "./contracts.ts";
import {
  evaluateCapabilities,
  probeWalCapability,
  type CapabilityProbeResult,
  type RuntimeVersions,
  type RuntimeVersionsProvider,
} from "./capability-probe.server.ts";
import {
  getUnderlyingDatabaseSync,
  NodeSqliteDatabase,
} from "./infrastructure/node-sqlite-database.server.ts";

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
   * Directory used for the WAL capability probe. Defaults to the database
   * directory for file databases and to the OS temp directory for `:memory:`.
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
  ) {}

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
    const probeDirectory =
      options.probeDirectory ??
      (path === MEMORY_PATH ? tmpdir() : dirname(path));
    const probe = runWalProbe(probeDirectory);
    const evaluation = evaluateCapabilities(versions, probe);
    if (!evaluation.supported) {
      throw new DatabaseError("capability-mismatch", "open", {
        cause: evaluation.failureReason,
        retryable: false,
      });
    }

    let connection: SqliteDatabasePort;
    try {
      connection = options.adapterFactory
        ? options.adapterFactory(path)
        : new NodeSqliteDatabase({ path });
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError("io-failure", "open", { cause: error });
    }

    try {
      applyAndAssertPragmas(connection, path === MEMORY_PATH);
    } catch (error) {
      closeBestEffort(connection);
      if (error instanceof DatabaseError) throw error;
      if (error instanceof PragmaAssertionFailure) {
        throw new DatabaseError(error.code, "open", { retryable: false });
      }
      throw new DatabaseError("capability-mismatch", "open", { cause: error });
    }

    const host = new DatabaseHost(path, versions, connection);
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
    return fn(getUnderlyingDatabaseSync(this.connection));
  }

  /** Closes the connection and releases the singleton registration. */
  close(): void {
    OPEN_HOSTS.delete(this.path);
    closeBestEffort(this.connection);
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
 * fresh machine must not fail just because `~/.trusttools/data` does not exist
 * yet, and a genuine filesystem failure must still be a stable error code.
 */
function ensureDirectory(directory: string): void {
  try {
    mkdirSync(directory, { recursive: true });
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

function closeBestEffort(connection: SqliteDatabasePort): void {
  try {
    if (connection.isOpen) connection.close();
  } catch {
    // The singleton registration is already released; a failing close is
    // reported by later opens.
  }
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
