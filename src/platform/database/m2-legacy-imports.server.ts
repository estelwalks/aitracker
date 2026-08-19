import type { MonitoringStatus } from "../../modules/monitoring/contracts.ts";
import { monitoringStatusSchema } from "../../modules/monitoring/infrastructure.ts";
import {
  JobRunSchema,
  preferenceSchema,
  taskRunsSchema,
  type TaskPreferencesFile,
  type TaskRunsFile,
} from "../../modules/tasks/application/task-storage.ts";
import type { AtomicJsonStore } from "../persistence/contracts.ts";
import type { SqliteDatabasePort } from "./contracts.ts";
import {
  importAtomicJsonStore,
  type LegacyImportResult,
} from "./legacy-import.server.ts";
import { assertAppPreferenceValueSafe } from "./privacy-guard.server.ts";
import { epoch, stableJson } from "./sqlite-values.server.ts";

export function importLegacyTaskPreferences(options: {
  database: SqliteDatabasePort;
  source: AtomicJsonStore<TaskPreferencesFile>;
  sourceIdentity: string;
}): Promise<LegacyImportResult> {
  return importAtomicJsonStore({
    ...options,
    importValue(value, database) {
      const parsed = preferenceSchema().parse(value);
      const upsert = database.prepare(
        `INSERT INTO task_preferences (task_id, enabled, schedule_kind, interval_minutes, weekday, day_of_month, local_time, timezone, options_json, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?) ON CONFLICT (task_id) DO UPDATE SET enabled = excluded.enabled, schedule_kind = excluded.schedule_kind, interval_minutes = excluded.interval_minutes, weekday = excluded.weekday, day_of_month = excluded.day_of_month, local_time = excluded.local_time, updated_at_ms = excluded.updated_at_ms`,
      );
      const updatedAtMs = Date.parse(parsed.updatedAt);
      let rowsWritten = 0;
      for (const [taskId, preference] of Object.entries(parsed.tasks)) {
        const schedule = preference.schedule;
        rowsWritten += Number(
          upsert.run(
            taskId,
            preference.enabled ? 1 : 0,
            schedule?.kind ?? null,
            schedule?.kind === "interval" ? schedule.minutes : null,
            schedule?.kind === "weekly" ? schedule.weekday : null,
            schedule?.kind === "monthly" ? schedule.dayOfMonth : null,
            schedule && schedule.kind !== "interval"
              ? schedule.localTime
              : null,
            updatedAtMs,
          ).changes,
        );
      }
      return { rowsRead: Object.keys(parsed.tasks).length, rowsWritten };
    },
  });
}

export function importLegacyTaskRuns(options: {
  database: SqliteDatabasePort;
  source: AtomicJsonStore<TaskRunsFile>;
  sourceIdentity: string;
}): Promise<LegacyImportResult> {
  return importAtomicJsonStore({
    ...options,
    importValue(value, database) {
      const parsed = taskRunsSchema().parse(value);
      const upsert = database.prepare(
        `INSERT INTO task_runs (run_id, task_id, trigger, status, queued_at_ms, started_at_ms, finished_at_ms, duration_ms, attempt, correlation_id, error_code, retryable, input_fingerprint, output_ref, scanned, changed, diagnostic_count, skipped_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (run_id) DO UPDATE SET task_id = excluded.task_id, trigger = excluded.trigger, status = excluded.status, queued_at_ms = excluded.queued_at_ms, started_at_ms = excluded.started_at_ms, finished_at_ms = excluded.finished_at_ms, duration_ms = excluded.duration_ms, attempt = excluded.attempt, correlation_id = excluded.correlation_id, error_code = excluded.error_code, retryable = excluded.retryable, input_fingerprint = excluded.input_fingerprint, output_ref = excluded.output_ref, scanned = excluded.scanned, changed = excluded.changed, diagnostic_count = excluded.diagnostic_count, skipped_reason = excluded.skipped_reason`,
      );
      let rowsWritten = 0;
      for (const candidate of parsed.runs) {
        const run = JobRunSchema.parse(candidate);
        rowsWritten += Number(
          upsert.run(
            run.runId,
            run.taskId,
            run.trigger,
            run.status,
            epoch(run.queuedAt),
            epoch(run.startedAt),
            epoch(run.finishedAt),
            run.durationMs ?? null,
            run.attempt,
            run.correlationId,
            run.errorCode ?? null,
            run.retryable == null ? null : run.retryable ? 1 : 0,
            run.inputFingerprint ?? null,
            run.outputRef ?? null,
            run.summary?.scanned ?? null,
            run.summary?.changed ?? null,
            run.summary?.diagnosticCount ?? null,
            run.summary?.skippedReason ?? null,
          ).changes,
        );
      }
      return { rowsRead: parsed.runs.length, rowsWritten };
    },
  });
}

export function importLegacyMonitoringStatus(options: {
  database: SqliteDatabasePort;
  source: AtomicJsonStore<MonitoringStatus | null>;
  sourceIdentity: string;
}): Promise<LegacyImportResult> {
  return importAtomicJsonStore({
    ...options,
    importValue(value, database) {
      if (value == null) return { rowsRead: 0, rowsWritten: 0 };
      const status = monitoringStatusSchema.parse(value);
      database
        .prepare(
          `INSERT INTO monitoring_state (singleton_id, running, started_at_ms, heartbeat_at_ms, pending_count, security_summary_json, updated_at_ms) VALUES (1, 0, ?, ?, ?, ?, ?) ON CONFLICT (singleton_id) DO UPDATE SET running = 0, started_at_ms = excluded.started_at_ms, heartbeat_at_ms = excluded.heartbeat_at_ms, pending_count = excluded.pending_count, security_summary_json = excluded.security_summary_json, updated_at_ms = excluded.updated_at_ms`,
        )
        .run(
          epoch(status.startedAt),
          epoch(status.heartbeatAt),
          status.pendingCount,
          status.security ? stableJson(status.security) : null,
          Date.now(),
        );
      const upsert = database.prepare(
        `INSERT INTO monitoring_collectors (collector_id, state, pending, last_started_at_ms, last_succeeded_at_ms, last_failed_at_ms, error_code) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (collector_id) DO UPDATE SET state = excluded.state, pending = excluded.pending, last_started_at_ms = excluded.last_started_at_ms, last_succeeded_at_ms = excluded.last_succeeded_at_ms, last_failed_at_ms = excluded.last_failed_at_ms, error_code = excluded.error_code`,
      );
      for (const collector of status.collectors) {
        upsert.run(
          collector.id,
          collector.state === "running" ? "idle" : collector.state,
          collector.pending ? 1 : 0,
          epoch(collector.lastStartedAt),
          epoch(collector.lastSucceededAt),
          epoch(collector.lastFailedAt),
          collector.errorCode ?? null,
        );
      }
      return {
        rowsRead: 1 + status.collectors.length,
        rowsWritten: 1 + status.collectors.length,
      };
    },
  });
}

export function importLegacyRuntimeFlag<T>(options: {
  database: SqliteDatabasePort;
  source: AtomicJsonStore<T>;
  sourceIdentity: string;
  flagKey: string;
}): Promise<LegacyImportResult> {
  return importAtomicJsonStore({
    ...options,
    importValue(value, database) {
      assertAppPreferenceValueSafe(options.flagKey, value);
      database
        .prepare(
          `INSERT INTO runtime_flags (flag_key, value_json, updated_at_ms) VALUES (?, ?, ?) ON CONFLICT (flag_key) DO UPDATE SET value_json = excluded.value_json, updated_at_ms = excluded.updated_at_ms`,
        )
        .run(options.flagKey, stableJson(value), Date.now());
      return { rowsRead: 1, rowsWritten: 1 };
    },
  });
}
