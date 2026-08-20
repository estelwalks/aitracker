import type { SqliteDatabasePort } from "../../../platform/database/contracts.ts";
import {
  sqliteInteger,
  sqliteNullableText,
  sqliteText,
} from "../../../platform/database/sqlite-values.server.ts";
import type { Clock } from "../../../platform/persistence/contracts.ts";
import {
  DEFAULT_TASK_PREFERENCES,
  TASK_PREFERENCES_SCHEMA_VERSION,
  TaskPreferenceSchema,
  preferenceSchema,
  validateTaskId,
  type Schedule,
  type TaskPreference,
  type TaskPreferenceRepository,
  type TaskPreferencesFile,
} from "../application/task-storage.ts";

export interface SqliteTaskPreferenceRepositoryOptions {
  readonly database: SqliteDatabasePort;
  readonly clock?: Clock;
}

const SELECT_ALL = `SELECT task_id, enabled, schedule_kind, interval_minutes, weekday, day_of_month, local_time FROM task_preferences ORDER BY task_id`;
const UPSERT = `INSERT INTO task_preferences (task_id, enabled, schedule_kind, interval_minutes, weekday, day_of_month, local_time, timezone, options_json, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?) ON CONFLICT (task_id) DO UPDATE SET enabled = excluded.enabled, schedule_kind = excluded.schedule_kind, interval_minutes = excluded.interval_minutes, weekday = excluded.weekday, day_of_month = excluded.day_of_month, local_time = excluded.local_time, updated_at_ms = excluded.updated_at_ms`;

export function createSqliteTaskPreferenceRepository(
  options: SqliteTaskPreferenceRepositoryOptions,
): TaskPreferenceRepository {
  const clock = options.clock ?? { now: () => new Date() };
  const readAll = (): TaskPreferencesFile => {
    const tasks: Record<string, TaskPreference> = {};
    let updatedAtMs = 0;
    for (const row of options.database.prepare(SELECT_ALL).all()) {
      const taskId = sqliteText(row.task_id);
      validateTaskId(taskId);
      const schedule = scheduleFromRow(row);
      tasks[taskId] = TaskPreferenceSchema.parse({
        enabled: sqliteInteger(row.enabled) === 1,
        ...(schedule ? { schedule } : {}),
      });
    }
    const stamp = options.database
      .prepare("SELECT MAX(updated_at_ms) AS value FROM task_preferences")
      .get();
    if (stamp?.value != null) updatedAtMs = sqliteInteger(stamp.value);
    return {
      schemaVersion: TASK_PREFERENCES_SCHEMA_VERSION,
      updatedAt: new Date(updatedAtMs).toISOString(),
      tasks,
    };
  };

  const upsert = (
    taskId: string,
    preference: TaskPreference,
    nowMs: number,
  ) => {
    validateTaskId(taskId);
    const parsed = TaskPreferenceSchema.parse(preference);
    const schedule = parsed.schedule;
    options.database
      .prepare(UPSERT)
      .run(
        taskId,
        parsed.enabled ? 1 : 0,
        schedule?.kind ?? null,
        schedule?.kind === "interval" ? schedule.minutes : null,
        schedule?.kind === "weekly" ? schedule.weekday : null,
        schedule?.kind === "monthly" ? schedule.dayOfMonth : null,
        schedule && schedule.kind !== "interval" ? schedule.localTime : null,
        nowMs,
      );
  };

  return {
    async read() {
      return readAll();
    },
    async get(taskId) {
      validateTaskId(taskId);
      return readAll().tasks[taskId];
    },
    async save(preferences) {
      const parsed = preferenceSchema().parse(preferences);
      const transaction = options.database.transaction();
      transaction.begin();
      try {
        options.database.prepare("DELETE FROM task_preferences").run();
        const nowMs = Date.parse(parsed.updatedAt);
        for (const [taskId, preference] of Object.entries(parsed.tasks)) {
          upsert(taskId, preference, nowMs);
        }
        transaction.commit();
      } catch (error) {
        transaction.rollback();
        throw error;
      }
    },
    async set(taskId, preference) {
      const parsed = TaskPreferenceSchema.parse(preference);
      upsert(taskId, parsed, clock.now().getTime());
      return readAll();
    },
  };
}

function scheduleFromRow(
  row: Readonly<Record<string, unknown>>,
): Schedule | undefined {
  const kind = sqliteNullableText(row.schedule_kind);
  if (kind === undefined) return undefined;
  if (kind === "interval") {
    return { kind, minutes: sqliteInteger(row.interval_minutes) };
  }
  const localTime = sqliteText(row.local_time);
  if (kind === "daily") return { kind, localTime };
  if (kind === "weekly") {
    return { kind, weekday: sqliteInteger(row.weekday), localTime };
  }
  return {
    kind: "monthly",
    dayOfMonth: sqliteInteger(row.day_of_month),
    localTime,
  };
}

export { DEFAULT_TASK_PREFERENCES };
