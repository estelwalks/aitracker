import { createHash, randomUUID } from "node:crypto";

import type { AtomicJsonStore } from "../persistence/contracts.ts";
import type {
  DataMigrationRun,
  DataMigrationSourceKind,
} from "./data-migration.contracts.ts";
import { DatabaseError, type SqliteDatabasePort } from "./contracts.ts";
import {
  sqliteInteger,
  sqliteText,
  stableJson,
} from "./sqlite-values.server.ts";

export interface LegacyImportResult extends DataMigrationRun {
  /** True when an already-succeeded fingerprint made this call a no-op. */
  readonly idempotentHit: boolean;
}

export interface AtomicJsonImportOptions<T> {
  readonly database: SqliteDatabasePort;
  readonly source: AtomicJsonStore<T>;
  /** Used only to derive an irreversible hash; never persisted or returned. */
  readonly sourceIdentity: string;
  readonly sourceKind?: DataMigrationSourceKind;
  readonly importValue: (
    value: T,
    database: SqliteDatabasePort,
  ) => { rowsRead: number; rowsWritten: number; rowsSkipped?: number };
  readonly now?: () => number;
}

/**
 * Imports one legacy AtomicJsonStore in a transaction shared with its audit
 * row. Repeating the same source fingerprint is a no-op; a failed attempt may
 * be retried without violating the table's unique idempotency key.
 */
export async function importAtomicJsonStore<T>(
  options: AtomicJsonImportOptions<T>,
): Promise<LegacyImportResult> {
  const read = await options.source.read();
  const serialized = stableJson(read.value);
  const sourceKind = options.sourceKind ?? "atomic-json";
  const sourcePathHash = digest(options.sourceIdentity);
  const sourceFingerprint = digest(serialized);
  const existing = findRun(
    options.database,
    sourceKind,
    sourcePathHash,
    sourceFingerprint,
  );
  if (existing?.status === "succeeded")
    return { ...existing, idempotentHit: true };

  const runId = existing?.runId ?? `migration-${randomUUID()}`;
  const now = options.now ?? Date.now;
  const startedAtMs = now();
  const transaction = options.database.transaction();
  transaction.begin();
  try {
    options.database
      .prepare(
        `INSERT INTO data_migration_runs (run_id, source_kind, source_path_hash, source_schema_version, status, started_at_ms, finished_at_ms, rows_read, rows_written, rows_skipped, error_code, source_fingerprint) VALUES (?, ?, ?, ?, 'running', ?, NULL, 0, 0, 0, NULL, ?) ON CONFLICT (source_kind, source_path_hash, source_fingerprint) DO UPDATE SET status = 'running', started_at_ms = excluded.started_at_ms, finished_at_ms = NULL, rows_read = 0, rows_written = 0, rows_skipped = 0, error_code = NULL`,
      )
      .run(
        runId,
        sourceKind,
        sourcePathHash,
        read.schemaVersion,
        startedAtMs,
        sourceFingerprint,
      );
    const counts = options.importValue(read.value, options.database);
    const finishedAtMs = now();
    options.database
      .prepare(
        `UPDATE data_migration_runs SET status = 'succeeded', finished_at_ms = ?, rows_read = ?, rows_written = ?, rows_skipped = ? WHERE run_id = ?`,
      )
      .run(
        finishedAtMs,
        counts.rowsRead,
        counts.rowsWritten,
        counts.rowsSkipped ?? 0,
        runId,
      );
    transaction.commit();
    return {
      runId,
      sourceKind,
      sourcePathHash,
      sourceSchemaVersion: read.schemaVersion,
      status: "succeeded",
      startedAtMs,
      finishedAtMs,
      rowsRead: counts.rowsRead,
      rowsWritten: counts.rowsWritten,
      rowsSkipped: counts.rowsSkipped ?? 0,
      errorCode: null,
      sourceFingerprint,
      idempotentHit: false,
    };
  } catch (error) {
    transaction.rollback();
    const finishedAtMs = now();
    options.database
      .prepare(
        `INSERT INTO data_migration_runs (run_id, source_kind, source_path_hash, source_schema_version, status, started_at_ms, finished_at_ms, rows_read, rows_written, rows_skipped, error_code, source_fingerprint) VALUES (?, ?, ?, ?, 'failed', ?, ?, 0, 0, 0, 'errors.database.legacy-import', ?) ON CONFLICT (source_kind, source_path_hash, source_fingerprint) DO UPDATE SET status = 'failed', finished_at_ms = excluded.finished_at_ms, error_code = excluded.error_code`,
      )
      .run(
        runId,
        sourceKind,
        sourcePathHash,
        read.schemaVersion,
        startedAtMs,
        finishedAtMs,
        sourceFingerprint,
      );
    throw new DatabaseError("sql-error", "migration", {
      cause: error,
      retryable: false,
    });
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function findRun(
  database: SqliteDatabasePort,
  sourceKind: DataMigrationSourceKind,
  sourcePathHash: string,
  sourceFingerprint: string,
): DataMigrationRun | undefined {
  const row = database
    .prepare(
      "SELECT run_id, source_kind, source_path_hash, source_schema_version, status, started_at_ms, finished_at_ms, rows_read, rows_written, rows_skipped, error_code, source_fingerprint FROM data_migration_runs WHERE source_kind = ? AND source_path_hash = ? AND source_fingerprint = ?",
    )
    .get(sourceKind, sourcePathHash, sourceFingerprint);
  if (!row) return undefined;
  return {
    runId: sqliteText(row.run_id),
    sourceKind: sqliteText(row.source_kind) as DataMigrationSourceKind,
    sourcePathHash: sqliteText(row.source_path_hash),
    sourceSchemaVersion:
      row.source_schema_version == null
        ? null
        : sqliteInteger(row.source_schema_version),
    status: sqliteText(row.status) as DataMigrationRun["status"],
    startedAtMs:
      row.started_at_ms == null ? null : sqliteInteger(row.started_at_ms),
    finishedAtMs:
      row.finished_at_ms == null ? null : sqliteInteger(row.finished_at_ms),
    rowsRead: sqliteInteger(row.rows_read),
    rowsWritten: sqliteInteger(row.rows_written),
    rowsSkipped: sqliteInteger(row.rows_skipped),
    errorCode: row.error_code == null ? null : sqliteText(row.error_code),
    sourceFingerprint: sqliteText(row.source_fingerprint),
  };
}
