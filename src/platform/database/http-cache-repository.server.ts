import { createHash } from "node:crypto";

import { DatabaseError, type SqliteDatabasePort } from "./contracts.ts";
import {
  sqliteInteger,
  sqliteNullableText,
  sqliteText,
  stableJson,
} from "./sqlite-values.server.ts";

export interface HttpCacheEntry<T> {
  readonly namespace: string;
  readonly key: string;
  readonly payload: T;
  readonly etag?: string;
  readonly fetchedAtMs: number;
  readonly expiresAtMs: number;
  readonly statusCode?: number;
}

export interface HttpCacheRepository {
  get<T>(
    namespace: string,
    key: string,
  ): Promise<HttpCacheEntry<T> | undefined>;
  put<T>(entry: HttpCacheEntry<T>): Promise<void>;
  deleteExpired(namespace: string, nowMs?: number): Promise<number>;
}

const SAFE_NAMESPACE = /^[a-z][a-z0-9-]{0,63}$/;
const MAX_PAYLOAD_BYTES = 1024 * 1024;

export function createSqliteHttpCacheRepository(
  database: SqliteDatabasePort,
): HttpCacheRepository {
  return {
    async get<T>(namespace: string, key: string) {
      assertIdentity(namespace, key);
      const row = database
        .prepare(
          "SELECT payload_json, etag, fetched_at_ms, expires_at_ms, status_code FROM http_cache_entries WHERE namespace = ? AND cache_key = ?",
        )
        .get(namespace, hashCacheKey(key));
      if (!row) return undefined;
      return {
        namespace,
        key,
        payload: JSON.parse(sqliteText(row.payload_json)) as T,
        ...(sqliteNullableText(row.etag) ? { etag: sqliteText(row.etag) } : {}),
        fetchedAtMs: sqliteInteger(row.fetched_at_ms),
        expiresAtMs: sqliteInteger(row.expires_at_ms),
        ...(row.status_code == null
          ? {}
          : { statusCode: sqliteInteger(row.status_code) }),
      };
    },
    async put(entry) {
      assertIdentity(entry.namespace, entry.key);
      if (entry.expiresAtMs < entry.fetchedAtMs) throw invalid();
      const payload = stableJson(entry.payload);
      const bytes = Buffer.byteLength(payload, "utf8");
      if (bytes > MAX_PAYLOAD_BYTES || containsForbiddenCacheContent(payload))
        throw invalid();
      database
        .prepare(
          `INSERT INTO http_cache_entries (namespace, cache_key, payload_json, etag, fetched_at_ms, expires_at_ms, status_code, payload_bytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (namespace, cache_key) DO UPDATE SET payload_json = excluded.payload_json, etag = excluded.etag, fetched_at_ms = excluded.fetched_at_ms, expires_at_ms = excluded.expires_at_ms, status_code = excluded.status_code, payload_bytes = excluded.payload_bytes`,
        )
        .run(
          entry.namespace,
          hashCacheKey(entry.key),
          payload,
          entry.etag ?? null,
          entry.fetchedAtMs,
          entry.expiresAtMs,
          entry.statusCode ?? null,
          bytes,
        );
    },
    async deleteExpired(namespace, nowMs = Date.now()) {
      if (!SAFE_NAMESPACE.test(namespace)) throw invalid();
      return Number(
        database
          .prepare(
            "DELETE FROM http_cache_entries WHERE namespace = ? AND expires_at_ms <= ?",
          )
          .run(namespace, nowMs).changes,
      );
    },
  };
}

function assertIdentity(namespace: string, key: string): void {
  if (!SAFE_NAMESPACE.test(namespace) || key.length === 0 || key.length > 4096)
    throw invalid();
}

function hashCacheKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function containsForbiddenCacheContent(text: string): boolean {
  return (
    /Bearer\s/i.test(text) ||
    /[A-Za-z]:[\\/]/.test(text) ||
    /\\\\/.test(text) ||
    /\/(?:Users|home|etc|var|tmp|mnt|Volumes)\//i.test(text) ||
    /"(?:api[_-]?key|password|secret|token)"\s*:/i.test(text)
  );
}

function invalid(): DatabaseError {
  return new DatabaseError("invalid-argument", "write", { retryable: false });
}
