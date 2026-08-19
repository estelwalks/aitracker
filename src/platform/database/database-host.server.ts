/**
 * Database Host (Story S-01, T-01-03): single-connection lifecycle.
 *
 * Server-only. Owns one writable connection per absolute path (in-process
 * singleton), runs the capability probe before opening, and applies + asserts
 * the required PRAGMAs. The Host holds only the adapter and the probe results
 * — it contains zero business SQL. On any assertion failure the connection is
 * closed and a stable error code is returned; journal semantics are never
 * silently downgraded and the database is never destructively rebuilt.
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

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
import { NodeSqliteDatabase } from "./infrastructure/node-sqlite-database.server.ts";

const OPEN_HOSTS = new Map<string, DatabaseHost>();

export interface DatabaseHostOptions {
  /** Database file path or `":memory:"` for a throwaway in-memory database. */
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
    /** Normalized absolute path this host is registered under. */
    readonly path: string,
    /** Versions recorded and evaluated at open time. */
    readonly runtimeVersions: RuntimeVersions,
    private readonly connection: SqliteDatabasePort,
  ) {}

  static open(options: DatabaseHostOptions): DatabaseHost {
    const path = normalizeDatabasePath(options.path);
    if (OPEN_HOSTS.has(path)) {
      throw new DatabaseError("already-open", "open");
    }

    const versions = options.versionsProvider.getVersions();
    // The WAL probe and the connection both need the directory to exist. Doing
    // this before probing keeps a missing data directory from surfacing as a
    // raw ENOENT instead of a stable database error code.
    if (path !== ":memory:") ensureDirectory(dirname(path));
    const probeDirectory =
      options.probeDirectory ??
      (path === ":memory:" ? tmpdir() : dirname(path));
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
      applyAndAssertPragmas(connection, path === ":memory:");
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
    return this.connection.prepare(sql);
  }

  exec(sql: string): void {
    this.connection.exec(sql);
  }

  transaction(): Transaction {
    return this.connection.transaction();
  }

  /** Closes the connection and releases the singleton registration. */
  close(): void {
    OPEN_HOSTS.delete(this.path);
    closeBestEffort(this.connection);
  }
}

function normalizeDatabasePath(path: string): string {
  return path === ":memory:" || path === "" ? ":memory:" : resolve(path);
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
