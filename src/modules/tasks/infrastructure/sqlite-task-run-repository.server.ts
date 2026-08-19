import type { SqliteDatabasePort } from "../../../platform/database/contracts.ts";
import {
  epoch,
  iso,
  sqliteInteger,
  sqliteNullableText,
  sqliteText,
} from "../../../platform/database/sqlite-values.server.ts";
import type { Clock } from "../../../platform/persistence/contracts.ts";
import {
  JobRunSchema,
  validateTaskId,
  type JobRun,
  type TaskRunRepository,
} from "../application/task-storage.ts";

export interface SqliteTaskRunRepositoryOptions {
  readonly database: SqliteDatabasePort;
  readonly clock?: Clock;
  readonly maxEntries?: number;
}

const UPSERT = `INSERT INTO task_runs (run_id, task_id, trigger, status, queued_at_ms, started_at_ms, finished_at_ms, duration_ms, attempt, correlation_id, error_code, retryable, input_fingerprint, output_ref, scanned, changed, diagnostic_count, skipped_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (run_id) DO UPDATE SET task_id = excluded.task_id, trigger = excluded.trigger, status = excluded.status, queued_at_ms = excluded.queued_at_ms, started_at_ms = excluded.started_at_ms, finished_at_ms = excluded.finished_at_ms, duration_ms = excluded.duration_ms, attempt = excluded.attempt, correlation_id = excluded.correlation_id, error_code = excluded.error_code, retryable = excluded.retryable, input_fingerprint = excluded.input_fingerprint, output_ref = excluded.output_ref, scanned = excluded.scanned, changed = excluded.changed, diagnostic_count = excluded.diagnostic_count, skipped_reason = excluded.skipped_reason`;
const SELECT_COLUMNS = `run_id, task_id, trigger, status, queued_at_ms, started_at_ms, finished_at_ms, duration_ms, attempt, correlation_id, error_code, retryable, input_fingerprint, output_ref, scanned, changed, diagnostic_count, skipped_reason`;

export function createSqliteTaskRunRepository(
  options: SqliteTaskRunRepositoryOptions,
): TaskRunRepository {
  const clock = options.clock ?? { now: () => new Date() };
  const maxEntries = Math.max(1, options.maxEntries ?? 500);
  return {
    async append(run) {
      const value = JobRunSchema.parse(run);
      validateTaskId(value.taskId);
      const summary = value.summary;
      options.database
        .prepare(UPSERT)
        .run(
          value.runId,
          value.taskId,
          value.trigger,
          value.status,
          epoch(value.queuedAt),
          epoch(value.startedAt),
          epoch(value.finishedAt),
          value.durationMs ?? null,
          value.attempt,
          value.correlationId,
          value.errorCode ?? null,
          value.retryable == null ? null : value.retryable ? 1 : 0,
          value.inputFingerprint ?? null,
          value.outputRef ?? null,
          summary?.scanned ?? null,
          summary?.changed ?? null,
          summary?.diagnosticCount ?? null,
          summary?.skippedReason ?? null,
        );
      await this.compact();
    },
    async list(query = {}) {
      const limit = Math.max(0, Math.floor(query.limit ?? maxEntries));
      if (limit === 0) return [];
      const rows = query.taskId
        ? options.database
            .prepare(
              `SELECT ${SELECT_COLUMNS} FROM task_runs WHERE task_id = ? ORDER BY COALESCE(started_at_ms, queued_at_ms, 0) DESC, rowid DESC LIMIT ?`,
            )
            .all(validateTaskId(query.taskId), limit)
        : options.database
            .prepare(
              `SELECT ${SELECT_COLUMNS} FROM task_runs ORDER BY COALESCE(started_at_ms, queued_at_ms, 0) DESC, rowid DESC LIMIT ?`,
            )
            .all(limit);
      return rows.map(runFromRow);
    },
    async recoverRunning() {
      const pending = options.database
        .prepare(
          `SELECT ${SELECT_COLUMNS} FROM task_runs WHERE status IN ('running', 'queued') ORDER BY rowid`,
        )
        .all()
        .map(runFromRow);
      const finishedAt = clock.now();
      const statement = options.database.prepare(
        `UPDATE task_runs SET status = 'abandoned', finished_at_ms = ?, duration_ms = CASE WHEN started_at_ms IS NULL THEN duration_ms ELSE MAX(0, ? - started_at_ms) END, error_code = 'errors.tasks.abandoned', retryable = 1 WHERE run_id = ?`,
      );
      const transaction = options.database.transaction();
      transaction.begin();
      try {
        for (const run of pending)
          statement.run(finishedAt.getTime(), finishedAt.getTime(), run.runId);
        transaction.commit();
      } catch (error) {
        transaction.rollback();
        throw error;
      }
      return pending.map((run) =>
        JobRunSchema.parse({
          ...run,
          status: "abandoned",
          finishedAt: finishedAt.toISOString(),
          ...(run.startedAt
            ? {
                durationMs: Math.max(
                  0,
                  finishedAt.getTime() - Date.parse(run.startedAt),
                ),
              }
            : {}),
          errorCode: "errors.tasks.abandoned",
          retryable: true,
        }),
      );
    },
    async compact() {
      options.database
        .prepare(
          `DELETE FROM task_runs WHERE run_id IN (SELECT run_id FROM task_runs ORDER BY COALESCE(started_at_ms, queued_at_ms, 0) DESC, rowid DESC LIMIT -1 OFFSET ?)`,
        )
        .run(maxEntries);
    },
    async rotate() {
      await this.compact();
    },
  };
}

function runFromRow(row: Readonly<Record<string, unknown>>): JobRun {
  const summary = {
    ...(row.scanned == null ? {} : { scanned: sqliteInteger(row.scanned) }),
    ...(row.changed == null ? {} : { changed: sqliteInteger(row.changed) }),
    ...(row.diagnostic_count == null
      ? {}
      : { diagnosticCount: sqliteInteger(row.diagnostic_count) }),
    ...(row.skipped_reason == null
      ? {}
      : { skippedReason: sqliteText(row.skipped_reason) }),
  };
  return JobRunSchema.parse({
    runId: sqliteText(row.run_id),
    taskId: sqliteText(row.task_id),
    trigger: sqliteText(row.trigger),
    status: sqliteText(row.status),
    ...(iso(row.queued_at_ms) ? { queuedAt: iso(row.queued_at_ms) } : {}),
    ...(iso(row.started_at_ms) ? { startedAt: iso(row.started_at_ms) } : {}),
    ...(iso(row.finished_at_ms) ? { finishedAt: iso(row.finished_at_ms) } : {}),
    ...(row.duration_ms == null
      ? {}
      : { durationMs: sqliteInteger(row.duration_ms) }),
    attempt: sqliteInteger(row.attempt),
    correlationId: sqliteText(row.correlation_id),
    ...(sqliteNullableText(row.error_code)
      ? { errorCode: sqliteText(row.error_code) }
      : {}),
    ...(row.retryable == null
      ? {}
      : { retryable: sqliteInteger(row.retryable) === 1 }),
    ...(sqliteNullableText(row.input_fingerprint)
      ? { inputFingerprint: sqliteText(row.input_fingerprint) }
      : {}),
    ...(sqliteNullableText(row.output_ref)
      ? { outputRef: sqliteText(row.output_ref) }
      : {}),
    ...(Object.keys(summary).length ? { summary } : {}),
  });
}
