import type { SqliteDatabasePort } from "../platform/database/contracts.ts";
import { sqliteText } from "../platform/database/sqlite-values.server.ts";
import type { Clock } from "../platform/persistence/contracts.ts";
import {
  DEFAULT_PERFORMANCE_ROLLOUT_STATE,
  isLegalRolloutMigration,
  performanceRolloutSchema,
  type PerformanceRolloutRepository,
  type PerformanceRolloutState,
} from "./performance-rollout.ts";

const FLAG = "performance.rollout";

export function createSqlitePerformanceRolloutRepository(
  database: SqliteDatabasePort,
  clock: Clock = { now: () => new Date() },
): PerformanceRolloutRepository {
  const read = (): PerformanceRolloutState => {
    const row = database
      .prepare(
        "SELECT value_json, updated_at_ms FROM runtime_flags WHERE flag_key = ?",
      )
      .get(FLAG);
    if (!row) return DEFAULT_PERFORMANCE_ROLLOUT_STATE;
    try {
      return performanceRolloutSchema.parse(
        JSON.parse(sqliteText(row.value_json)),
      );
    } catch {
      return DEFAULT_PERFORMANCE_ROLLOUT_STATE;
    }
  };
  const write = (state: PerformanceRolloutState): void => {
    const parsed = performanceRolloutSchema.parse(state);
    database
      .prepare(
        `INSERT INTO runtime_flags (flag_key, value_json, updated_at_ms)
      VALUES (?, ?, ?) ON CONFLICT (flag_key) DO UPDATE SET
      value_json=excluded.value_json, updated_at_ms=excluded.updated_at_ms`,
      )
      .run(
        FLAG,
        JSON.stringify(parsed),
        parsed.updatedAt ? Date.parse(parsed.updatedAt) : 0,
      );
  };
  return {
    async read() {
      return read();
    },
    async setStage(stage) {
      const current = read();
      if (!isLegalRolloutMigration(current.stage, stage))
        throw new TypeError("Illegal rollout migration");
      const next = { ...current, stage, updatedAt: clock.now().toISOString() };
      write(next);
      return next;
    },
  };
}
