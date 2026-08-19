import type { SqliteDatabasePort } from "./contracts.ts";

/**
 * Database-backed retention (S-03, T-03-04). Replaces the legacy filesystem
 * cache pruning: the only app-owned caches that still expire are the SQLite
 * `http_cache_entries` and `insight_enhancement_cache` tables.
 *
 * Snapshot generations are deliberately NOT pruned here — `commitGeneration`
 * already keeps the current head plus one previous generation per domain, so a
 * second, divergent cleanup path would risk deleting a generation another
 * transaction is about to promote to head.
 */

/** How long an invalidated insight cache row is kept before reclamation. */
const INVALIDATED_GRACE_MS = 24 * 60 * 60 * 1000;

export interface DatabaseRetentionSummary {
  readonly httpCacheDeleted: number;
  readonly insightCacheDeleted: number;
  /** Always 0; generation retention lives inside `commitGeneration`. */
  readonly snapshotGenerationsDeleted: number;
  readonly generatedAt: string;
}

export interface DatabaseCacheClearSummary {
  readonly httpCacheDeleted: number;
  readonly insightCacheDeleted: number;
}

function changes(value: number | bigint): number {
  return Number(value);
}

/**
 * Removes expired rows from the app-owned caches. Returns the per-table
 * deletion counts so the caller can log/report them.
 */
export function applyDatabaseRetention(
  database: SqliteDatabasePort,
  nowMs: number,
): DatabaseRetentionSummary {
  const httpCacheDeleted = changes(
    database
      .prepare("DELETE FROM http_cache_entries WHERE expires_at_ms < ?")
      .run(nowMs).changes,
  );
  // Expired rows, plus invalidated rows that have outlived the grace period
  // (their TTL may not have lapsed yet, but they are already stale by design).
  const insightCacheDeleted = changes(
    database
      .prepare(
        `DELETE FROM insight_enhancement_cache
         WHERE expires_at_ms < ? OR (status = 'invalidated' AND generated_at_ms < ?)`,
      )
      .run(nowMs, nowMs - INVALIDATED_GRACE_MS).changes,
  );
  return {
    httpCacheDeleted,
    insightCacheDeleted,
    snapshotGenerationsDeleted: 0,
    generatedAt: new Date(nowMs).toISOString(),
  };
}

/** Clears every regenerable cache row (the settings "clear cache" action). */
export function clearRegenerableDatabaseCaches(
  database: SqliteDatabasePort,
): DatabaseCacheClearSummary {
  return {
    httpCacheDeleted: changes(
      database.prepare("DELETE FROM http_cache_entries").run().changes,
    ),
    insightCacheDeleted: changes(
      database.prepare("DELETE FROM insight_enhancement_cache").run().changes,
    ),
  };
}
