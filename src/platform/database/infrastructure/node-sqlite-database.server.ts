/**
 * `node:sqlite` adapter implementing `SqliteDatabasePort` (Story S-01).
 *
 * Server-only. The `DatabaseSync` type never leaves this module: callers only
 * ever see the contracts in `../contracts.ts`.
 */
import { DatabaseSync, type StatementSync } from "node:sqlite";

import {
  DatabaseError,
  type DatabaseErrorCode,
  type DatabaseOperation,
  type SqliteBindValue,
  type SqliteDatabasePort,
  type SqliteRow,
  type SqliteRunResult,
  type SqliteStatement,
  type Transaction,
} from "../contracts.ts";

/**
 * Strict connection options required by ADR decision 6 and architecture §3.2:
 * busy timeout, BigInt reads, no extensions, strict named parameters and
 * defensive mode. The capability probe reuses the exact same option set so
 * probe behaviour matches the real connection.
 */
export const NODE_SQLITE_CONNECTION_OPTIONS = {
  timeout: 5000,
  readBigInts: true,
  allowExtension: false,
  allowBareNamedParameters: false,
  allowUnknownNamedParameters: false,
  defensive: true,
} as const;

export interface NodeSqliteDatabaseOptions {
  readonly path: string;
}

const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_INTEGER_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);

/**
 * Converts a BigInt read from the database into a JavaScript number, refusing
 * values outside the safe integer range instead of silently losing precision.
 */
export function bigintToSafeNumber(value: bigint): number {
  if (value > MAX_SAFE_INTEGER_BIGINT || value < MIN_SAFE_INTEGER_BIGINT) {
    throw new DatabaseError("integer-overflow", "read", { retryable: false });
  }
  return Number(value);
}

/** Lossless BigInt-to-string conversion for identifiers and large counters. */
export function bigintToSafeString(value: bigint): string {
  return value.toString();
}

export class NodeSqliteDatabase implements SqliteDatabasePort {
  private readonly database: DatabaseSync;

  constructor(options: NodeSqliteDatabaseOptions) {
    try {
      this.database = new DatabaseSync(
        options.path,
        NODE_SQLITE_CONNECTION_OPTIONS,
      );
    } catch (error) {
      throw mapSqliteError(error, "open");
    }
  }

  get isOpen(): boolean {
    return this.database.isOpen;
  }

  prepare(sql: string): SqliteStatement {
    try {
      return new NodeSqliteStatement(this.database.prepare(sql));
    } catch (error) {
      throw mapSqliteError(error, "read");
    }
  }

  exec(sql: string): void {
    try {
      this.database.exec(sql);
    } catch (error) {
      throw mapSqliteError(error, "write");
    }
  }

  transaction(): Transaction {
    return new NodeSqliteTransaction(this.database);
  }

  close(): void {
    if (!this.database.isOpen) return;
    try {
      this.database.close();
    } catch (error) {
      throw mapSqliteError(error, "close");
    }
  }
}

export class NodeSqliteStatement implements SqliteStatement {
  constructor(private readonly statement: StatementSync) {}

  get(...anonymousParameters: SqliteBindValue[]): SqliteRow | undefined;
  get(
    namedParameters: Readonly<Record<string, SqliteBindValue>>,
    ...anonymousParameters: SqliteBindValue[]
  ): SqliteRow | undefined;
  get(...args: unknown[]): SqliteRow | undefined {
    const { named, anonymous } = splitBindArguments(args);
    try {
      const row =
        named === undefined
          ? this.statement.get(...anonymous)
          : this.statement.get(
              named as Record<string, SqliteBindValue>,
              ...anonymous,
            );
      return row === undefined ? undefined : (row as SqliteRow);
    } catch (error) {
      throw mapSqliteError(error, "read");
    }
  }

  all(...anonymousParameters: SqliteBindValue[]): SqliteRow[];
  all(
    namedParameters: Readonly<Record<string, SqliteBindValue>>,
    ...anonymousParameters: SqliteBindValue[]
  ): SqliteRow[];
  all(...args: unknown[]): SqliteRow[] {
    const { named, anonymous } = splitBindArguments(args);
    try {
      const rows =
        named === undefined
          ? this.statement.all(...anonymous)
          : this.statement.all(
              named as Record<string, SqliteBindValue>,
              ...anonymous,
            );
      return rows as SqliteRow[];
    } catch (error) {
      throw mapSqliteError(error, "read");
    }
  }

  run(...anonymousParameters: SqliteBindValue[]): SqliteRunResult;
  run(
    namedParameters: Readonly<Record<string, SqliteBindValue>>,
    ...anonymousParameters: SqliteBindValue[]
  ): SqliteRunResult;
  run(...args: unknown[]): SqliteRunResult {
    const { named, anonymous } = splitBindArguments(args);
    try {
      const result =
        named === undefined
          ? this.statement.run(...anonymous)
          : this.statement.run(
              named as Record<string, SqliteBindValue>,
              ...anonymous,
            );
      return {
        changes: result.changes,
        lastInsertRowid: result.lastInsertRowid,
      };
    } catch (error) {
      throw mapSqliteError(error, "write");
    }
  }
}

export class NodeSqliteTransaction implements Transaction {
  private active = false;

  constructor(private readonly database: DatabaseSync) {}

  begin(): void {
    if (this.active) {
      throw new DatabaseError("invalid-argument", "transaction");
    }
    try {
      this.database.exec("BEGIN");
      this.active = true;
    } catch (error) {
      throw mapSqliteError(error, "transaction");
    }
  }

  commit(): void {
    if (!this.active) {
      throw new DatabaseError("invalid-argument", "transaction");
    }
    try {
      this.database.exec("COMMIT");
      this.active = false;
    } catch (error) {
      throw mapSqliteError(error, "transaction");
    }
  }

  rollback(): void {
    if (!this.active) {
      throw new DatabaseError("invalid-argument", "transaction");
    }
    try {
      this.database.exec("ROLLBACK");
      this.active = false;
    } catch (error) {
      throw mapSqliteError(error, "transaction");
    }
  }
}

function splitBindArguments(args: readonly unknown[]): {
  named: Readonly<Record<string, SqliteBindValue>> | undefined;
  anonymous: SqliteBindValue[];
} {
  const first = args[0];
  if (isNamedParameterRecord(first)) {
    return { named: first, anonymous: args.slice(1) as SqliteBindValue[] };
  }
  return { named: undefined, anonymous: args as SqliteBindValue[] };
}

function isNamedParameterRecord(
  value: unknown,
): value is Readonly<Record<string, SqliteBindValue>> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Uint8Array)
  );
}

/**
 * Maps raw driver errors to stable `DatabaseError`s. Classification prefers the
 * SQLite extended error code when present and falls back to well-known message
 * fragments; the mapped message never contains a filesystem path.
 */
export function mapSqliteError(
  error: unknown,
  operation: DatabaseOperation,
): DatabaseError {
  if (error instanceof DatabaseError) return error;
  const cause = error instanceof Error ? error : new Error(String(error));
  const candidate = error as {
    errcode?: unknown;
    message?: unknown;
  };
  const message =
    typeof candidate.message === "string" ? candidate.message : "";
  return new DatabaseError(
    sqliteErrorCode(candidate.errcode, message),
    operation,
    { cause },
  );
}

function sqliteErrorCode(errcode: unknown, message: string): DatabaseErrorCode {
  const primary = typeof errcode === "number" ? errcode & 0xff : 0;
  const text = message.toLowerCase();
  if (
    text.includes("unknown named parameter") ||
    text.includes("cannot start a transaction within a transaction")
  ) {
    return "invalid-argument";
  }
  if (
    primary === 26 /* SQLITE_NOTADB */ ||
    primary === 11 /* SQLITE_CORRUPT */ ||
    text.includes("file is not a database") ||
    text.includes("database disk image is malformed")
  ) {
    return "corrupt";
  }
  if (
    primary === 5 /* SQLITE_BUSY */ ||
    text.includes("database is locked") ||
    text.includes("database table is locked")
  ) {
    return "busy";
  }
  if (
    primary === 19 /* SQLITE_CONSTRAINT */ ||
    text.includes("constraint failed")
  ) {
    return "constraint-violation";
  }
  if (
    primary === 14 /* SQLITE_CANTOPEN */ ||
    text.includes("unable to open database file")
  ) {
    return "io-failure";
  }
  if (primary === 8 /* SQLITE_READONLY */) {
    return "access-denied";
  }
  return "sql-error";
}
