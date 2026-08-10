import { SystemClock } from "../../../platform/persistence/clock.ts";
import type { Clock } from "../../../platform/persistence/contracts.ts";
import {
  DEFAULT_TASK_PREFERENCES,
  preferenceSchema,
  TaskPreferenceSchema,
  type TaskPreference,
  type TaskPreferencesFile,
  type TaskPreferenceRepository,
  type TaskPreferenceRepositoryOptions,
} from "../application/task-storage.ts";

export function createTaskPreferenceRepository(
  options: TaskPreferenceRepositoryOptions,
): TaskPreferenceRepository {
  const clock: Clock = options.clock ?? new SystemClock();
  return {
    async read() {
      return (await options.store.read()).value;
    },
    async get(taskId) {
      return (await this.read()).tasks[taskId];
    },
    async save(preferences) {
      const parsed = preferenceSchema(clock).parse(preferences);
      await options.store.write(parsed);
    },
    async set(taskId, preference) {
      const parsedPreference = TaskPreferenceSchema.parse(preference);
      const current = await this.read();
      const next: TaskPreferencesFile = {
        schemaVersion: current.schemaVersion,
        updatedAt: clock.now().toISOString(),
        tasks: { ...current.tasks, [taskId]: parsedPreference },
      };
      await this.save(next);
      return next;
    },
  };
}

export { DEFAULT_TASK_PREFERENCES };
