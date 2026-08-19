import type { SqliteDatabasePort } from "../../platform/database/contracts.ts";
import {
  epoch,
  iso,
  sqliteInteger,
  sqliteNullableText,
  sqliteText,
  stableJson,
} from "../../platform/database/sqlite-values.server.ts";
import type {
  MonitoringCollectorStatus,
  MonitoringStatus,
  MonitoringStatusStore,
} from "./contracts.ts";
import { monitoringModuleId } from "./contracts.ts";
import { monitoringStatusSchema } from "./infrastructure.ts";

export function createSqliteMonitoringStatusStore(
  database: SqliteDatabasePort,
): MonitoringStatusStore {
  return {
    async load() {
      const state = database
        .prepare(
          "SELECT running, started_at_ms, heartbeat_at_ms, pending_count, security_summary_json FROM monitoring_state WHERE singleton_id = 1",
        )
        .get();
      if (!state) return undefined;
      const collectors = database
        .prepare(
          "SELECT collector_id, state, pending, last_started_at_ms, last_succeeded_at_ms, last_failed_at_ms, error_code FROM monitoring_collectors ORDER BY collector_id",
        )
        .all()
        .map(collectorFromRow);
      return monitoringStatusSchema.parse({
        module: monitoringModuleId,
        running: sqliteInteger(state.running) === 1,
        ...(iso(state.started_at_ms)
          ? { startedAt: iso(state.started_at_ms) }
          : {}),
        ...(iso(state.heartbeat_at_ms)
          ? { heartbeatAt: iso(state.heartbeat_at_ms) }
          : {}),
        pendingCount: sqliteInteger(state.pending_count),
        collectors,
        ...(state.security_summary_json == null
          ? {}
          : { security: JSON.parse(sqliteText(state.security_summary_json)) }),
      });
    },
    async save(status) {
      const parsed = monitoringStatusSchema.parse(status);
      const transaction = database.transaction();
      transaction.begin();
      try {
        database
          .prepare(
            `INSERT INTO monitoring_state (singleton_id, running, started_at_ms, heartbeat_at_ms, pending_count, security_summary_json, updated_at_ms) VALUES (1, ?, ?, ?, ?, ?, ?) ON CONFLICT (singleton_id) DO UPDATE SET running = excluded.running, started_at_ms = excluded.started_at_ms, heartbeat_at_ms = excluded.heartbeat_at_ms, pending_count = excluded.pending_count, security_summary_json = excluded.security_summary_json, updated_at_ms = excluded.updated_at_ms`,
          )
          .run(
            parsed.running ? 1 : 0,
            epoch(parsed.startedAt),
            epoch(parsed.heartbeatAt),
            parsed.pendingCount,
            parsed.security ? stableJson(parsed.security) : null,
            Date.now(),
          );
        database.prepare("DELETE FROM monitoring_collectors").run();
        const insert = database.prepare(
          "INSERT INTO monitoring_collectors (collector_id, state, pending, last_started_at_ms, last_succeeded_at_ms, last_failed_at_ms, error_code) VALUES (?, ?, ?, ?, ?, ?, ?)",
        );
        for (const collector of parsed.collectors) {
          insert.run(
            collector.id,
            collector.state,
            collector.pending ? 1 : 0,
            epoch(collector.lastStartedAt),
            epoch(collector.lastSucceededAt),
            epoch(collector.lastFailedAt),
            collector.errorCode ?? null,
          );
        }
        transaction.commit();
      } catch (error) {
        transaction.rollback();
        throw error;
      }
    },
  };
}

function collectorFromRow(
  row: Readonly<Record<string, unknown>>,
): MonitoringCollectorStatus {
  return {
    id: sqliteText(row.collector_id) as MonitoringCollectorStatus["id"],
    state: sqliteText(row.state) as MonitoringCollectorStatus["state"],
    pending: sqliteInteger(row.pending) === 1,
    ...(iso(row.last_started_at_ms)
      ? { lastStartedAt: iso(row.last_started_at_ms) }
      : {}),
    ...(iso(row.last_succeeded_at_ms)
      ? { lastSucceededAt: iso(row.last_succeeded_at_ms) }
      : {}),
    ...(iso(row.last_failed_at_ms)
      ? { lastFailedAt: iso(row.last_failed_at_ms) }
      : {}),
    ...(sqliteNullableText(row.error_code)
      ? { errorCode: sqliteText(row.error_code) as `errors.${string}` }
      : {}),
  };
}
