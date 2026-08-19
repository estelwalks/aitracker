import type { SqliteDatabasePort } from "./contracts.ts";
import { assertAppPreferenceValueSafe } from "./privacy-guard.server.ts";
import {
  sqliteInteger,
  sqliteText,
  stableJson,
} from "./sqlite-values.server.ts";

export interface RuntimeFlagRecord<T> {
  readonly key: string;
  readonly value: T;
  readonly updatedAtMs: number;
}

export interface RuntimeFlagRepository {
  get<T>(key: string): Promise<RuntimeFlagRecord<T> | undefined>;
  set<T>(key: string, value: T, updatedAtMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
}

const SAFE_KEY = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

export function createSqliteRuntimeFlagRepository(
  database: SqliteDatabasePort,
): RuntimeFlagRepository {
  const checkKey = (key: string) => {
    if (!SAFE_KEY.test(key) || key.length > 128)
      throw new TypeError("Invalid runtime flag key");
  };
  return {
    async get<T>(key: string) {
      checkKey(key);
      const row = database
        .prepare(
          "SELECT value_json, updated_at_ms FROM runtime_flags WHERE flag_key = ?",
        )
        .get(key);
      if (!row) return undefined;
      return {
        key,
        value: JSON.parse(sqliteText(row.value_json)) as T,
        updatedAtMs: sqliteInteger(row.updated_at_ms),
      };
    },
    async set(key, value, updatedAtMs = Date.now()) {
      checkKey(key);
      assertAppPreferenceValueSafe(key, value);
      database
        .prepare(
          "INSERT INTO runtime_flags (flag_key, value_json, updated_at_ms) VALUES (?, ?, ?) ON CONFLICT (flag_key) DO UPDATE SET value_json = excluded.value_json, updated_at_ms = excluded.updated_at_ms",
        )
        .run(key, stableJson(value), updatedAtMs);
    },
    async delete(key) {
      checkKey(key);
      database.prepare("DELETE FROM runtime_flags WHERE flag_key = ?").run(key);
    },
  };
}
