/**
 * Forward-only SQL migration runner (Story S-02, T-02-01).
 *
 * Server-only. Takes an already-opened `SqliteDatabasePort` (normally a
 * `DatabaseHost`) plus the immutable, ordered `MigrationDefinition[]` from
 * `./migrations/index.ts` and brings the database up to the newest known
 * version. Guarantees:
 *
 * - Every pending migration runs inside its **own** transaction together with
 *   its `schema_migrations` ledger row, so a crash mid-run never leaves a
 *   half-applied version recorded as applied. Re-running is idempotent.
 * - Only forward. A database whose ledger is ahead of, or diverges from, the
 *   definitions this build knows is rejected with a stable error code instead
 *   of being "fixed" destructively. There is no down migration.
 * - The checksum is SHA-256 over the line-ending-normalized SQL text, so a
 *   CRLF checkout (`core.autocrlf`) cannot invalidate an existing database.
 *
 * `schema_migrations` itself is created by migration 0001, inside the same
 * transaction that writes its first ledger row — the runner never bootstraps a
 * second, divergent copy of that DDL.
 */
import { createHash } from "node:crypto";

import {
  DatabaseError,
  type SqliteDatabasePort,
  type SqliteRow,
  type Transaction,
} from "./contracts.ts";
import { MIGRATIONS, type MigrationDefinition } from "./migrations/index.ts";
import { bigintToSafeNumber } from "./infrastructure/node-sqlite-database.server.ts";

export type { MigrationDefinition };

/** One applied migration as recorded in `schema_migrations`. */
export interface MigrationRecord {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
  readonly appVersion: string;
  readonly appliedAtMs: number;
  readonly durationMs: number;
}

export interface MigrationResult {
  /** Migrations applied by this call, in ascending version order. */
  readonly applied: readonly MigrationRecord[];
  /** Highest applied version after the call. */
  readonly currentVersion: number;
}

export interface MigrationRunnerOptions {
  /** Already-opened connection; the runner never opens or closes it. */
  readonly database: SqliteDatabasePort;
  /** Application version recorded on every row this call writes. */
  readonly appVersion: string;
  /** Defaults to the bundled `MIGRATIONS`; injectable for tests. */
  readonly definitions?: readonly MigrationDefinition[];
  /** Epoch-milliseconds source; defaults to `Date.now`. */
  readonly clock?: () => number;
}

const LEDGER_TABLE = "schema_migrations";

const LEDGER_EXISTS_SQL = `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${LEDGER_TABLE}'`;

const LEDGER_SELECT_SQL = `SELECT version, name, checksum FROM ${LEDGER_TABLE} ORDER BY version ASC`;

const LEDGER_INSERT_SQL = `INSERT INTO ${LEDGER_TABLE} (version, name, checksum, app_version, applied_at_ms, duration_ms) VALUES (?, ?, ?, ?, ?, ?)`;

/**
 * Canonical form used for checksums and dual-source comparison: BOM stripped
 * and CRLF collapsed to LF. Never used for execution — SQLite accepts the raw
 * text as-is.
 */
export function normalizeMigrationSql(sql: string): string {
  return sql.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}

/** SHA-256 (hex) of the canonical migration text. */
export function migrationChecksum(sql: string): string {
  return createHash("sha256")
    .update(normalizeMigrationSql(sql), "utf8")
    .digest("hex");
}

/** Highest applied version, or `0` when the ledger does not exist yet. */
export function readSchemaVersion(database: SqliteDatabasePort): number {
  const applied = readLedger(database);
  return applied.reduce((max, row) => Math.max(max, row.version), 0);
}

/**
 * Applies every pending migration in ascending version order. Returns the rows
 * written by this call plus the resulting schema version.
 */
export function runMigrations(
  options: MigrationRunnerOptions,
): MigrationResult {
  const definitions = options.definitions ?? MIGRATIONS;
  const clock = options.clock ?? Date.now;
  assertValidAppVersion(options.appVersion);
  assertValidDefinitions(definitions);

  const database = options.database;
  const definedByVersion = new Map<number, MigrationDefinition>();
  for (const definition of definitions) {
    definedByVersion.set(definition.version, definition);
  }
  const latestDefined = definitions[definitions.length - 1].version;

  const appliedRows = readLedger(database);
  const appliedVersions = new Set(appliedRows.map((row) => row.version));
  const currentVersion = appliedRows.reduce(
    (max, row) => Math.max(max, row.version),
    0,
  );

  // Forward-only: a database created by a newer build is never downgraded.
  if (currentVersion > latestDefined) {
    throw new DatabaseError("migration-reverted", "migration", {
      retryable: false,
    });
  }
  for (const row of appliedRows) {
    const definition = definedByVersion.get(row.version);
    if (definition === undefined) {
      // An applied version this build does not know about: the ledger belongs
      // to a different migration lineage.
      throw new DatabaseError("migration-reverted", "migration", {
        retryable: false,
      });
    }
    if (
      definition.name !== row.name ||
      migrationChecksum(definition.sql) !== row.checksum
    ) {
      throw new DatabaseError("migration-checksum", "migration", {
        retryable: false,
      });
    }
  }
  // A hole below the current version means the ledger is not on a known
  // forward-only path; applying it out of order would corrupt the sequence.
  for (const definition of definitions) {
    if (
      definition.version < currentVersion &&
      !appliedVersions.has(definition.version)
    ) {
      throw new DatabaseError("migration-reverted", "migration", {
        retryable: false,
      });
    }
  }

  const applied: MigrationRecord[] = [];
  let version = currentVersion;
  for (const definition of definitions) {
    if (appliedVersions.has(definition.version)) continue;
    applied.push(
      applyMigration(database, definition, options.appVersion, clock),
    );
    version = definition.version;
  }
  return { applied, currentVersion: version };
}

/** Executes one migration and its ledger row inside a single transaction. */
function applyMigration(
  database: SqliteDatabasePort,
  definition: MigrationDefinition,
  appVersion: string,
  clock: () => number,
): MigrationRecord {
  const checksum = migrationChecksum(definition.sql);
  const startedAtMs = timestamp(clock);
  const transaction = database.transaction();
  transaction.begin();
  try {
    database.exec(definition.sql);
    const appliedAtMs = Math.max(startedAtMs, timestamp(clock));
    const durationMs = appliedAtMs - startedAtMs;
    database
      .prepare(LEDGER_INSERT_SQL)
      .run(
        definition.version,
        definition.name,
        checksum,
        appVersion,
        appliedAtMs,
        durationMs,
      );
    transaction.commit();
    return {
      version: definition.version,
      name: definition.name,
      checksum,
      appVersion,
      appliedAtMs,
      durationMs,
    };
  } catch (error) {
    rollbackBestEffort(transaction);
    throw migrationFailure(error);
  }
}

/** Applied rows, or `[]` when migration 0001 has not created the ledger yet. */
function readLedger(
  database: SqliteDatabasePort,
): readonly { version: number; name: string; checksum: string }[] {
  try {
    if (database.prepare(LEDGER_EXISTS_SQL).get() === undefined) return [];
    return database
      .prepare(LEDGER_SELECT_SQL)
      .all()
      .map((row) => ({
        version: columnInteger(row, "version"),
        name: columnText(row, "name"),
        checksum: columnText(row, "checksum"),
      }));
  } catch (error) {
    throw migrationFailure(error);
  }
}

function rollbackBestEffort(transaction: Transaction): void {
  try {
    transaction.rollback();
  } catch {
    // The original failure is the one worth reporting; SQLite has already
    // aborted the transaction when ROLLBACK itself is refused.
  }
}

/** Keeps adapter error codes stable while re-tagging the operation. */
function migrationFailure(error: unknown): DatabaseError {
  if (error instanceof DatabaseError) {
    return new DatabaseError(error.code, "migration", { cause: error });
  }
  return new DatabaseError("sql-error", "migration", { cause: error });
}

function assertValidAppVersion(appVersion: string): void {
  if (typeof appVersion !== "string" || appVersion.trim() === "") {
    throw new DatabaseError("invalid-argument", "migration", {
      retryable: false,
    });
  }
}

/** Strictly increasing positive versions, unique names, non-empty SQL. */
function assertValidDefinitions(
  definitions: readonly MigrationDefinition[],
): void {
  if (definitions.length === 0) throw invalidDefinition();
  const names = new Set<string>();
  let previousVersion = 0;
  for (const definition of definitions) {
    if (
      !Number.isSafeInteger(definition.version) ||
      definition.version <= 0 ||
      definition.version <= previousVersion
    ) {
      throw invalidDefinition();
    }
    previousVersion = definition.version;
    if (typeof definition.name !== "string" || definition.name.trim() === "") {
      throw invalidDefinition();
    }
    if (names.has(definition.name)) throw invalidDefinition();
    names.add(definition.name);
    if (
      typeof definition.sql !== "string" ||
      normalizeMigrationSql(definition.sql).trim() === ""
    ) {
      throw invalidDefinition();
    }
  }
}

function invalidDefinition(): DatabaseError {
  return new DatabaseError("invalid-argument", "migration", {
    retryable: false,
  });
}

/** Non-negative integer epoch milliseconds; rejects unusable clocks. */
function timestamp(clock: () => number): number {
  const value = clock();
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DatabaseError("invalid-argument", "migration", {
      retryable: false,
    });
  }
  return Math.max(0, Math.trunc(value));
}

function columnInteger(row: SqliteRow, column: string): number {
  const value = row[column];
  if (typeof value === "bigint") return bigintToSafeNumber(value);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw unreadableLedger();
}

function columnText(row: SqliteRow, column: string): string {
  const value = row[column];
  if (typeof value === "string") return value;
  throw unreadableLedger();
}

/**
 * STRICT column types make this unreachable for a ledger this runner created;
 * it only fires for a foreign or damaged `schema_migrations` table, which must
 * never be silently rebuilt.
 */
function unreadableLedger(): DatabaseError {
  return new DatabaseError("corrupt", "migration", { retryable: false });
}
