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

/** Rows removed by the explicit "clear collected data" action. */
export interface DatabaseCollectedDataClearSummary {
  readonly snapshotGenerationsDeleted: number;
  readonly projectClassificationsDeleted: number;
  readonly searchDocumentsDeleted: number;
}

function changes(value: number | bigint): number {
  return Number(value);
}

function countValue(row: Record<string, unknown> | undefined): number {
  return Number(row?.count ?? 0);
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

/**
 * Removes local collector results while leaving user-owned configuration and
 * history intact. Snapshot child tables are linked with ON DELETE CASCADE, so
 * deleting generations also removes their aggregate rows, blobs and domain
 * projections atomically. Search rows are limited to collector projections;
 * report, knowledge and security indexes remain available.
 */
export function clearCollectedDatabaseData(
  database: SqliteDatabasePort,
): DatabaseCollectedDataClearSummary {
  const transaction = database.transaction();
  transaction.begin();
  try {
    const snapshotGenerationsDeleted = countValue(
      database
        .prepare("SELECT COUNT(*) AS count FROM snapshot_generations")
        .get(),
    );
    const projectClassificationsDeleted = countValue(
      database
        .prepare("SELECT COUNT(*) AS count FROM project_classifications")
        .get(),
    );
    const searchDocumentsDeleted = countValue(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM search_documents WHERE type IN ('agent', 'skill', 'session')",
        )
        .get(),
    );

    // snapshot_heads references generations with ON DELETE RESTRICT.
    database.prepare("DELETE FROM snapshot_heads").run();
    database.prepare("DELETE FROM snapshot_generations").run();
    database.prepare("DELETE FROM project_classifications").run();
    database
      .prepare(
        "DELETE FROM search_documents WHERE type IN ('agent', 'skill', 'session')",
      )
      .run();

    // Monitoring state is a derived view of collector activity. Do not touch
    // the security history tables; only reset the collection heartbeat and
    // collector rows so the next startup/refresh starts from initialization.
    database.prepare("DELETE FROM monitoring_collectors").run();
    database
      .prepare(
        `UPDATE monitoring_state
         SET running = 0, started_at_ms = NULL, heartbeat_at_ms = NULL,
             pending_count = 0, security_summary_json = NULL,
             updated_at_ms = ?
         WHERE singleton_id = 1`,
      )
      .run(Date.now());

    transaction.commit();
    return {
      snapshotGenerationsDeleted,
      projectClassificationsDeleted,
      searchDocumentsDeleted,
    };
  } catch (error) {
    try {
      transaction.rollback();
    } catch {
      // Preserve the original database failure.
    }
    throw error;
  }
}
