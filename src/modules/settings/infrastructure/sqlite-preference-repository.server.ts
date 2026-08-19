/**
 * SQLite persistence for renderer-safe application preferences and runtime
 * flags. SQL remains owned by the settings feature; callers only depend on
 * the browser-safe values returned from this adapter.
 */
import {
  DatabaseError,
  type SqliteDatabasePort,
} from "../../../platform/database/contracts.ts";
import { bigintToSafeNumber } from "../../../platform/database/infrastructure/node-sqlite-database.server.ts";
import { assertAppPreferenceValueSafe } from "../../../platform/database/privacy-guard.server.ts";

export type PreferenceValue =
  | null
  | boolean
  | number
  | string
  | readonly PreferenceValue[]
  | { readonly [key: string]: PreferenceValue };

export interface PreferenceEntry {
  readonly key: string;
  readonly value: PreferenceValue;
  readonly updatedAtMs: number;
}

function safeInteger(value: unknown): number {
  if (typeof value === "bigint") return bigintToSafeNumber(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  throw new DatabaseError("integer-overflow", "read", { retryable: false });
}

function assertTimestamp(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DatabaseError("invalid-argument", "write", { retryable: false });
  }
}

function serialize(
  key: string,
  value: PreferenceValue,
): {
  json: string;
  type: "string" | "number" | "boolean" | "object" | "array" | "null";
} {
  assertAppPreferenceValueSafe(key, value);
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new DatabaseError("invalid-argument", "write", { retryable: false });
  }
  const json = JSON.stringify(value);
  const type =
    value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  if (
    type === "undefined" ||
    type === "bigint" ||
    type === "function" ||
    type === "symbol"
  ) {
    throw new DatabaseError("invalid-argument", "write", { retryable: false });
  }
  return {
    json,
    type: type as "string" | "number" | "boolean" | "object" | "array" | "null",
  };
}

function parseJson(value: unknown): PreferenceValue {
  if (typeof value !== "string") {
    throw new DatabaseError("sql-error", "read", { retryable: false });
  }
  try {
    return JSON.parse(value) as PreferenceValue;
  } catch (error) {
    throw new DatabaseError("corrupt", "read", {
      cause: error,
      retryable: false,
    });
  }
}

function withTransaction<T>(database: SqliteDatabasePort, work: () => T): T {
  const transaction = database.transaction();
  transaction.begin();
  try {
    const result = work();
    transaction.commit();
    return result;
  } catch (error) {
    try {
      transaction.rollback();
    } catch {
      /* preserve the original error */
    }
    throw error;
  }
}

export interface SqlitePreferenceRepository {
  get(key: string): PreferenceEntry | undefined;
  list(): PreferenceEntry[];
  set(entry: PreferenceEntry): void;
  remove(key: string): boolean;
  /** Idempotent state import: an identical or older legacy row performs no write. */
  importLegacy(entries: readonly PreferenceEntry[]): {
    insertedOrUpdated: number;
  };
}

export function createSqlitePreferenceRepository(
  database: SqliteDatabasePort,
): SqlitePreferenceRepository {
  const getSql =
    "SELECT preference_key, value_json, updated_at_ms FROM app_preferences WHERE preference_key = ?";
  const listSql =
    "SELECT preference_key, value_json, updated_at_ms FROM app_preferences ORDER BY preference_key";
  const upsertSql = `INSERT INTO app_preferences (preference_key, value_json, value_type, updated_at_ms)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (preference_key) DO UPDATE SET
      value_json = excluded.value_json,
      value_type = excluded.value_type,
      updated_at_ms = excluded.updated_at_ms
    WHERE excluded.updated_at_ms > app_preferences.updated_at_ms
       OR (excluded.updated_at_ms = app_preferences.updated_at_ms
           AND (excluded.value_json <> app_preferences.value_json
                OR excluded.value_type <> app_preferences.value_type))`;

  function fromRow(row: Readonly<Record<string, unknown>>): PreferenceEntry {
    if (typeof row.preference_key !== "string") {
      throw new DatabaseError("corrupt", "read", { retryable: false });
    }
    return {
      key: row.preference_key,
      value: parseJson(row.value_json),
      updatedAtMs: safeInteger(row.updated_at_ms),
    };
  }

  function set(entry: PreferenceEntry): number {
    assertTimestamp(entry.updatedAtMs);
    const encoded = serialize(entry.key, entry.value);
    const result = database
      .prepare(upsertSql)
      .run(entry.key, encoded.json, encoded.type, BigInt(entry.updatedAtMs));
    return Number(result.changes);
  }

  return {
    get(key) {
      const row = database.prepare(getSql).get(key);
      return row ? fromRow(row) : undefined;
    },
    list() {
      return database.prepare(listSql).all().map(fromRow);
    },
    set(entry) {
      void set(entry);
    },
    remove(key) {
      return (
        Number(
          database
            .prepare("DELETE FROM app_preferences WHERE preference_key = ?")
            .run(key).changes,
        ) > 0
      );
    },
    importLegacy(entries) {
      return withTransaction(database, () => ({
        insertedOrUpdated: entries.reduce(
          (count, entry) => count + set(entry),
          0,
        ),
      }));
    },
  };
}
