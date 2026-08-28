/**
 * Narrow `node:sqlite` runtime helpers (review batch B, P1-6).
 *
 * WHY THIS MODULE EXISTS: the driver import must not spread across
 * `src/platform/database/**`. Only `infrastructure/**` may name `node:sqlite`,
 * so every throwaway connection the platform needs outside the long-lived
 * `NodeSqliteDatabase` adapter — the capability probe, the online backup, the
 * read-only verification connections — is expressed here as one narrow
 * function. Callers (`capability-probe.server.ts`, `backup.server.ts`) stay
 * free of the driver, which is what the
 * `platform-node-sqlite-outside-infrastructure` gate rule in
 * `scripts/verify-browser-server-boundary.mjs` enforces.
 *
 * Every function here opens its own connection with the strict option set from
 * `node-sqlite-database.server.ts` and closes it before returning. Raw driver
 * errors are propagated unchanged: mapping them to a stable `DatabaseError` is
 * the caller's decision, because only the caller knows the operation
 * (`backup`, `open`, …) the failure belongs to.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

import type { SqliteBindValue } from "../contracts.ts";
import { NODE_SQLITE_CONNECTION_OPTIONS } from "./node-sqlite-database.server.ts";

/** Strict options plus `readOnly`, for verification-only connections. */
const READ_ONLY_CONNECTION_OPTIONS = {
  ...NODE_SQLITE_CONNECTION_OPTIONS,
  readOnly: true,
} as const;

/**
 * Query-only view of one open connection. The `DatabaseSync` handle itself is
 * never exposed, so a caller cannot write, attach, or keep the handle alive.
 */
export interface ReadOnlySqliteSession {
  /** First column of the first row, or `undefined` when there is no row. */
  queryFirstColumn(sql: string): unknown;
  /** First column of every row (e.g. `PRAGMA quick_check` result lines). */
  queryFirstColumnAll(sql: string): unknown[];
  /** Every row as a plain record (BigInt integers, per the strict options). */
  queryRows(
    sql: string,
    ...parameters: SqliteBindValue[]
  ): Record<string, unknown>[];
  /** Closes the connection; safe to call once, in a `finally`. */
  close(): void;
}

/**
 * Opens `path` read-only with the strict option set. Throws the raw driver
 * error when the file cannot be opened — the caller decides whether that means
 * `corrupt`, `io-failure` or something else.
 */
export function openReadOnlySqlite(path: string): ReadOnlySqliteSession {
  const database = new DatabaseSync(path, READ_ONLY_CONNECTION_OPTIONS);
  return {
    queryFirstColumn(sql: string): unknown {
      return firstColumnValue(database.prepare(sql).get());
    },
    queryFirstColumnAll(sql: string): unknown[] {
      return database.prepare(sql).all().map(firstColumnValue);
    },
    queryRows(
      sql: string,
      ...parameters: SqliteBindValue[]
    ): Record<string, unknown>[] {
      return database
        .prepare(sql)
        .all(...parameters)
        .map((row) => row as Record<string, unknown>);
    },
    close(): void {
      if (database.isOpen) database.close();
    },
  };
}

/**
 * `SELECT sqlite_version()` from a throwaway `:memory:` connection. No
 * persistent connection is created, and nothing is written to disk.
 */
export function readRuntimeSqliteVersion(): string {
  const database = new DatabaseSync(":memory:", NODE_SQLITE_CONNECTION_OPTIONS);
  try {
    const row = database.prepare("SELECT sqlite_version() AS version").get();
    return typeof row?.version === "string" ? row.version : "unknown";
  } finally {
    database.close();
  }
}

/**
 * Creates a throwaway file-backed database inside `directory`, requests WAL,
 * and reports the `journal_mode` SQLite actually settled on. The temporary
 * directory is always removed, and no connection survives the call.
 */
export function probeJournalModeIn(directory: string): {
  readonly journalMode: string;
} {
  const probeDirectory = mkdtempSync(join(directory, "aitracker-wal-probe-"));
  const databasePath = join(probeDirectory, "probe.db");
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(databasePath, NODE_SQLITE_CONNECTION_OPTIONS);
    const row = database.prepare("PRAGMA journal_mode=WAL").get();
    return {
      journalMode:
        typeof row?.journal_mode === "string" ? row.journal_mode : "",
    };
  } finally {
    if (database !== undefined && database.isOpen) {
      database.close();
    }
    try {
      rmSync(probeDirectory, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
    } catch {
      // Best-effort cleanup of the throwaway probe database.
    }
  }
}

/**
 * `node:sqlite.backup()` against a **borrowed** live connection. The source
 * handle is owned by the `DatabaseHost`; this function neither opens nor closes
 * it, so the single-writer contract (architecture §3.2) is preserved. Resolves
 * with the number of copied pages.
 */
export function runOnlineBackup(
  source: DatabaseSync,
  destinationPath: string,
): Promise<number> {
  return backup(source, destinationPath);
}

/**
 * Switches a *closed*, freshly written backup file to the delete (rollback)
 * journal mode so it becomes one self-contained file, then reads the mode back
 * and asserts it settled on `delete`. A silent non-switch would leave a
 * WAL-mode backup that later read-only `quick_check`s would be forced to treat
 * as unverified (review finding P2-6). Throws the raw driver error; the caller
 * maps it.
 */
export function setJournalModeDelete(path: string): void {
  const database = new DatabaseSync(path, NODE_SQLITE_CONNECTION_OPTIONS);
  try {
    database.exec("PRAGMA journal_mode=DELETE");
    const row = database.prepare("PRAGMA journal_mode").get();
    const mode = typeof row?.journal_mode === "string" ? row.journal_mode : "";
    if (mode.toLowerCase() !== "delete") {
      throw new Error(
        `journal_mode did not normalize to delete (actual: ${mode || "<none>"})`,
      );
    }
  } finally {
    database.close();
  }
}

function firstColumnValue(row: unknown): unknown {
  if (typeof row !== "object" || row === null) return undefined;
  const values = Object.values(row);
  return values.length === 0 ? undefined : values[0];
}
