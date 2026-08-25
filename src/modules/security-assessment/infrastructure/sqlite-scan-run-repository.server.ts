import type {
  SecurityScanRunRecord,
  SecurityScanRunStatus,
} from "../../../../electron/contracts.ts";
import type { SqliteDatabasePort } from "../../../platform/database/contracts.ts";
import {
  epoch,
  iso,
  sqliteInteger,
  sqliteNullableText,
  sqliteText,
} from "../../../platform/database/sqlite-values.server.ts";

const COLUMNS = `scan_id, mode, trigger, locale, status, started_at_ms,
  finished_at_ms, discovered_count, queued_count, completed_count,
  failed_count, skipped_count, error_code, rule_version`;

const STATUSES = new Set<SecurityScanRunStatus>([
  "queued",
  "running",
  "complete",
  "partial",
  "failed",
  "cancelled",
]);

function nonNegative(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new TypeError(`${field} must be a non-negative integer`);
  return value;
}

function validate(record: SecurityScanRunRecord): SecurityScanRunRecord {
  if (!/^scan:[a-f0-9-]{36}$/u.test(record.scanId))
    throw new TypeError("Invalid security scan id");
  if (record.mode !== "quick" && record.mode !== "full")
    throw new TypeError("Invalid security scan mode");
  if (record.trigger !== "manual" && record.trigger !== "automatic")
    throw new TypeError("Invalid security scan trigger");
  if (!STATUSES.has(record.status))
    throw new TypeError("Invalid security scan status");
  for (const [field, value] of Object.entries({
    discoveredCount: record.discoveredCount,
    queuedCount: record.queuedCount,
    completedCount: record.completedCount,
    failedCount: record.failedCount,
    skippedCount: record.skippedCount,
  }))
    nonNegative(value, field);
  if (epoch(record.startedAt) == null)
    throw new TypeError("Security scan start time is required");
  if (record.finishedAt !== undefined) epoch(record.finishedAt);
  return structuredClone(record);
}

function fromRow(
  row: Readonly<Record<string, unknown>>,
): SecurityScanRunRecord {
  const status = sqliteText(row.status) as SecurityScanRunStatus;
  if (!STATUSES.has(status))
    throw new TypeError("Invalid persisted scan status");
  return validate({
    scanId: sqliteText(row.scan_id),
    mode: sqliteText(row.mode) as SecurityScanRunRecord["mode"],
    trigger: sqliteText(row.trigger) as SecurityScanRunRecord["trigger"],
    locale: sqliteText(row.locale) as SecurityScanRunRecord["locale"],
    status,
    startedAt: iso(row.started_at_ms)!,
    ...(iso(row.finished_at_ms) ? { finishedAt: iso(row.finished_at_ms) } : {}),
    discoveredCount: sqliteInteger(row.discovered_count),
    queuedCount: sqliteInteger(row.queued_count),
    completedCount: sqliteInteger(row.completed_count),
    failedCount: sqliteInteger(row.failed_count),
    skippedCount: sqliteInteger(row.skipped_count),
    ...(sqliteNullableText(row.error_code)
      ? { errorCode: sqliteText(row.error_code) }
      : {}),
    ...(sqliteNullableText(row.rule_version)
      ? { ruleVersion: sqliteText(row.rule_version) }
      : {}),
  });
}

export interface SecurityScanRunRepository {
  latest(): Promise<SecurityScanRunRecord | null>;
  save(record: SecurityScanRunRecord): Promise<void>;
  recoverInterrupted(finishedAt: string): Promise<number>;
}

export function createSqliteSecurityScanRunRepository(
  database: SqliteDatabasePort,
): SecurityScanRunRepository {
  return {
    async latest() {
      const row = database
        .prepare(
          `SELECT ${COLUMNS} FROM security_scan_runs ORDER BY started_at_ms DESC, scan_id DESC LIMIT 1`,
        )
        .get();
      return row ? fromRow(row) : null;
    },
    async save(raw) {
      const record = validate(raw);
      database
        .prepare(
          `INSERT INTO security_scan_runs (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (scan_id) DO UPDATE SET mode=excluded.mode,
            trigger=excluded.trigger, locale=excluded.locale, status=excluded.status,
            started_at_ms=excluded.started_at_ms, finished_at_ms=excluded.finished_at_ms,
            discovered_count=excluded.discovered_count, queued_count=excluded.queued_count,
            completed_count=excluded.completed_count, failed_count=excluded.failed_count,
            skipped_count=excluded.skipped_count, error_code=excluded.error_code,
            rule_version=excluded.rule_version`,
        )
        .run(
          record.scanId,
          record.mode,
          record.trigger,
          record.locale,
          record.status,
          epoch(record.startedAt),
          epoch(record.finishedAt),
          record.discoveredCount,
          record.queuedCount,
          record.completedCount,
          record.failedCount,
          record.skippedCount,
          record.errorCode ?? null,
          record.ruleVersion ?? null,
        );
    },
    async recoverInterrupted(finishedAt) {
      const finishedAtMs = epoch(finishedAt);
      if (finishedAtMs == null)
        throw new TypeError("Recovery time is required");
      return Number(
        database
          .prepare(
            `UPDATE security_scan_runs SET status='cancelled', finished_at_ms=?,
              error_code='security.scanInterrupted'
             WHERE status IN ('queued', 'running')`,
          )
          .run(finishedAtMs).changes,
      );
    },
  };
}
