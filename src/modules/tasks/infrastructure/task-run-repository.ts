import { SystemClock } from "../../../platform/persistence/clock.ts";
import type { Clock } from "../../../platform/persistence/contracts.ts";
import {
  JobRunSchema,
  taskRunsSchema,
  validateTaskId,
  type JobRun,
  type TaskRunRepository,
  type TaskRunRepositoryOptions,
} from "../application/task-storage.ts";

const DEFAULT_MAX_ENTRIES = 500;

export function createTaskRunRepository(
  options: TaskRunRepositoryOptions,
): TaskRunRepository {
  const clock: Clock = options.clock ?? new SystemClock();
  const maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
  // A background transition and a renderer query share this repository object.
  // NodeAtomicJsonStore rejects overlapping lock acquisition, so serialize the
  // repository's own operations before crossing the persistence boundary.
  let tail: Promise<void> = Promise.resolve();
  const serialized = async <T>(operation: () => Promise<T>): Promise<T> => {
    const next = tail.then(operation, operation);
    tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
  return {
    async append(run) {
      await serialized(async () => {
        const parsed = JobRunSchema.parse(run);
        validateTaskId(parsed.taskId);
        const current = (await options.store.read()).value;
        const runs = [...current.runs, parsed].slice(-maxEntries);
        await options.store.write({
          schemaVersion: current.schemaVersion,
          runs,
        });
      });
    },
    async list(query = {}) {
      return serialized(async () => {
        const runs = (await options.store.read()).value.runs;
        const filtered =
          query.taskId === undefined
            ? runs
            : runs.filter((run) => run.taskId === query.taskId);
        const limit =
          query.limit === undefined
            ? filtered.length
            : Math.max(0, Math.floor(query.limit));
        return filtered.slice(-limit).reverse();
      });
    },
    async recoverRunning() {
      return serialized(async () => {
        const current = (await options.store.read()).value;
        const recovered: JobRun[] = [];
        const finishedAt = clock.now().toISOString();
        const runs = current.runs.map((run) => {
          if (run.status !== "running" && run.status !== "queued") return run;
          const next: JobRun = {
            ...run,
            status: "abandoned",
            finishedAt,
            ...(run.startedAt
              ? {
                  durationMs: Math.max(
                    0,
                    Date.parse(finishedAt) - Date.parse(run.startedAt),
                  ),
                }
              : {}),
            errorCode: "errors.tasks.abandoned",
            retryable: true,
          } as JobRun;
          recovered.push(next);
          return next;
        });
        if (recovered.length)
          await options.store.write({
            schemaVersion: current.schemaVersion,
            runs,
          });
        return recovered;
      });
    },
    async compact() {
      await serialized(async () => {
        const current = (await options.store.read()).value;
        if (current.runs.length > maxEntries)
          await options.store.write({
            schemaVersion: current.schemaVersion,
            runs: current.runs.slice(-maxEntries),
          });
      });
    },
    async rotate() {
      await this.compact();
    },
  };
}
