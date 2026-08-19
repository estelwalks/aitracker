import type { Clock } from "../../../platform/persistence/contracts.ts";
import { SystemClock } from "../../../platform/persistence/clock.ts";
import {
  createCorrelationId,
  createRunId,
  createTaskId,
  type CorrelationId,
  type RunId,
  type TaskId,
} from "../../../shared/ids.ts";
import { JOB_DEFINITIONS } from "../definitions/job-catalog.generated.ts";
import type { JobTypeDefinition } from "../definitions/contracts.ts";
import type {
  Schedule,
  JobRun,
  JobRunStatus,
  TaskPreference,
  TaskPreferenceRepository,
  TaskRunRepository,
} from "./task-storage.ts";

export type SchedulerReason = "manual" | "startup" | "schedule";
export type QueuePriority = "interactive" | "background" | "maintenance";

export interface TaskExecutionContext {
  readonly taskId: TaskId;
  readonly runId: RunId;
  readonly attempt: number;
  readonly signal: AbortSignal;
  readonly correlationId: CorrelationId;
}

export interface TaskExecutionResult {
  readonly summary?: JobRun["summary"];
}

export interface TaskExecutionError extends Error {
  readonly code?: string;
  readonly retryable?: boolean;
}

export type TaskExecutor = (
  context: TaskExecutionContext,
) => Promise<TaskExecutionResult | void>;

export interface SchedulerOptions {
  readonly clock?: Clock;
  readonly preferences: TaskPreferenceRepository;
  readonly runs: TaskRunRepository;
  readonly catalog?: readonly JobTypeDefinition[];
  readonly executors?: Readonly<
    Partial<Record<JobTypeDefinition["executorKey"], TaskExecutor>>
  >;
  readonly maxQueueSize?: number;
  readonly setTimeout?: (
    handler: () => void,
    delay: number,
  ) => ReturnType<typeof setTimeout>;
  readonly clearTimeout?: (timer: ReturnType<typeof setTimeout>) => void;
  /**
   * P5-T5-06: global resource budget. Collection tasks acquire the "heavy"
   * permit before running so at most one heavy collector executes at a time.
   * Manual triggers raise queue priority but never bypass the budget.
   */
  readonly resourceBudget?: {
    acquire(
      resource: "heavy" | "file" | "classifier",
      signal?: AbortSignal,
    ): Promise<() => void>;
  };
}

export interface TaskScheduler {
  start(): Promise<void>;
  stop(): Promise<void>;
  runNow(request: { taskId: TaskId; reason: SchedulerReason }): Promise<JobRun>;
  cancel(runId: RunId | string): Promise<void>;
  getNextRunAt(taskId: TaskId, from?: Date): Date | undefined;
}

const TERMINAL = new Set<JobRunStatus>([
  "succeeded",
  "failed",
  "cancelled",
  "skipped",
  "abandoned",
]);
const PRIORITY: Record<QueuePriority, number> = {
  maintenance: 0,
  background: 1,
  interactive: 2,
};

function parseTime(value: string): [number, number] {
  const [hour, minute] = value.split(":").map(Number);
  return [hour, minute];
}

/** Calendar schedules use the host's local timezone. DST gaps are normalized by Date;
 * ambiguous fall-back times use the runtime's first occurrence. This is deliberate: the
 * catalog has no timezone field, so schedules never silently imply UTC. */
export function nextRunAt(schedule: Schedule, from: Date): Date {
  if (schedule.kind === "interval")
    return new Date(from.getTime() + schedule.minutes * 60_000);
  const candidate = new Date(from.getTime());
  const [hour, minute] = parseTime(schedule.localTime);
  candidate.setHours(hour, minute, 0, 0);
  if (schedule.kind === "daily") {
    if (candidate <= from) candidate.setDate(candidate.getDate() + 1);
    return candidate;
  }
  if (schedule.kind === "monthly") {
    // Local calendar semantics: a day-of-month beyond the target month's length
    // clamps to its last day (31st fires on Feb 28/29), matching how a user
    // reads "每月 31 号" rather than rolling into the following month.
    const clamp = (day: number, year: number, monthIndex: number) =>
      Math.min(day, new Date(year, monthIndex + 1, 0).getDate());
    candidate.setDate(
      clamp(schedule.dayOfMonth, candidate.getFullYear(), candidate.getMonth()),
    );
    if (candidate <= from) {
      // Normalize to the 1st before shifting months so a clamped/short month
      // never rolls the date twice (e.g. Jan 31 → Feb has no 31st).
      candidate.setDate(1);
      candidate.setMonth(candidate.getMonth() + 1);
      candidate.setDate(
        clamp(
          schedule.dayOfMonth,
          candidate.getFullYear(),
          candidate.getMonth(),
        ),
      );
    }
    return candidate;
  }
  const weekday = schedule.weekday;
  const current = candidate.getDay() === 0 ? 7 : candidate.getDay();
  let delta = (weekday - current + 7) % 7;
  if (delta === 0 && candidate <= from) delta = 7;
  candidate.setDate(candidate.getDate() + delta);
  return candidate;
}

/**
 * Resolves the user override once, before any due calculation.  The scheduler
 * must never use the catalog schedule when a valid preference is present:
 * doing so makes an enabled 60 minute task fire every 15 minutes when another
 * task wakes the shared timer.
 */
export function effectiveSchedule(
  definition: JobTypeDefinition,
  preference: TaskPreference | undefined,
): Schedule {
  return preference?.schedule ?? (definition.defaultSchedule as Schedule);
}

/** Last *successful terminal* completion. Failed/cancelled attempts do not
 * advance collection freshness and therefore cannot postpone a retry. */
export function lastSuccessfulFinishedAt(
  runs: readonly JobRun[],
): Date | undefined {
  let latest: Date | undefined;
  for (const run of runs) {
    if (run.status !== "succeeded" || !run.finishedAt) continue;
    const value = new Date(run.finishedAt);
    if (Number.isNaN(value.getTime())) continue;
    if (!latest || value > latest) latest = value;
  }
  return latest;
}

export function isScheduleDue(
  schedule: Schedule,
  lastSuccess: Date | undefined,
  now: Date,
): boolean {
  return lastSuccess === undefined || nextRunAt(schedule, lastSuccess) <= now;
}

function stableJitter(runId: string, attempt: number): number {
  let hash = 2166136261;
  for (const char of `${runId}:${attempt}`)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) / 0xffffffff;
}

function asError(value: unknown): TaskExecutionError {
  if (value instanceof Error) return value as TaskExecutionError;
  return Object.assign(new Error("Task execution failed"), {
    retryable: false,
  });
}

function taskErrorCode(error: TaskExecutionError): `errors.${string}` {
  const code = error.code;
  // Task-run persistence intentionally accepts a compact lowercase code
  // grammar. Feature-level error keys may be camel-cased for i18n, so retain
  // those only in in-memory diagnostics and persist the scheduler fallback.
  return code && /^errors\.[a-z0-9][a-z0-9._-]*$/.test(code)
    ? (code as `errors.${string}`)
    : "errors.tasks.execution-failed";
}

/**
 * Default-enabled tasks when the user has no persisted preference (P3-T3-10).
 * Snapshot-refresh tasks are on by default so data never goes stale just
 * because a preference file was never written. Business plan tasks
 * (retention/reports) stay opt-in.
 */
const DEFAULT_ENABLED_TASK_IDS = new Set([
  "usage.refresh",
  "skills.refresh",
  "sessions.refresh",
  "exchange.refresh",
  "installation.refresh",
]);

export function createTaskScheduler(options: SchedulerOptions): TaskScheduler {
  const clock = options.clock ?? new SystemClock();
  const catalog = options.catalog ?? JOB_DEFINITIONS;
  const executors = options.executors ?? {};
  const maxQueueSize = options.maxQueueSize ?? 100;
  const setTimer =
    options.setTimeout ?? ((handler, delay) => setTimeout(handler, delay));
  const clearTimer = options.clearTimeout ?? ((timer) => clearTimeout(timer));
  const queue: Array<{
    run: JobRun;
    definition: JobTypeDefinition;
    priority: QueuePriority;
  }> = [];
  const active = new Map<
    string,
    { run: JobRun; controller: AbortController }
  >();
  const activeExecutions = new Set<Promise<void>>();
  let sequence = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let started = false;
  // A successful terminal record is the source of truth for freshness. This
  // small in-memory guard merely prevents a slow/failed task from repeatedly
  // being enqueued while its last success remains stale.
  const lastScheduledAt = new Map<string, Date>();

  const definitionFor = (taskId: TaskId) =>
    catalog.find((item) => item.id === taskId);
  const nowIso = () => clock.now().toISOString();
  // NodeAtomicJsonStore deliberately reports simultaneous writer/reader
  // attempts as a lock conflict. Scheduler transitions are asynchronous, so
  // serialize this runtime's own accesses instead of turning a harmless
  // completion + scheduling read into a failed listener.
  let runStoreTail: Promise<void> = Promise.resolve();
  const withRuns = async <T>(operation: () => Promise<T>): Promise<T> => {
    const next = runStoreTail.then(operation, operation);
    runStoreTail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
  const append = async (run: JobRun) => {
    await withRuns(() => options.runs.append(run));
    return run;
  };
  const transition = async (
    run: JobRun,
    status: JobRunStatus,
    extra: Partial<JobRun> = {},
  ) =>
    append({
      ...run,
      status,
      ...extra,
      ...(TERMINAL.has(status) ? { finishedAt: nowIso() } : {}),
    });

  const drain = async (): Promise<void> => {
    while (queue.length) {
      queue.sort(
        (a, b) =>
          PRIORITY[b.priority] - PRIORITY[a.priority] ||
          Date.parse(a.run.queuedAt ?? "") - Date.parse(b.run.queuedAt ?? ""),
      );
      const item = queue.shift();
      if (!item) return;
      const current = active.get(item.run.taskId);
      if (current) continue;
      const controller = new AbortController();
      active.set(item.run.taskId, { run: item.run, controller });
      const running = await transition(item.run, "running", {
        startedAt: nowIso(),
      });
      active.set(item.run.taskId, { run: running, controller });
      const execution = execute(running, item.definition, controller).finally(
        () => {
          void drain();
        },
      );
      activeExecutions.add(execution);
      void execution.finally(() => activeExecutions.delete(execution));
    }
  };

  const execute = async (
    run: JobRun,
    definition: JobTypeDefinition,
    controller: AbortController,
  ): Promise<void> => {
    const executor = executors[definition.executorKey];
    const timeoutTimer = setTimer(
      () => controller.abort(),
      definition.timeoutMs,
    );
    // P5-T5-06: heavy collectors (category "collection") share the global
    // heavy permit; the release is idempotent and always runs, so cancelled
    // or failed tasks can never leak a permit. Manual triggers raise queue
    // priority (runNow) but never bypass this budget.
    const isHeavy = definition.category === "collection";
    const releaseHeavy = isHeavy
      ? await options.resourceBudget
          ?.acquire("heavy", controller.signal)
          .catch(() => undefined)
      : undefined;
    try {
      if (!executor)
        throw Object.assign(new Error("Executor unavailable"), {
          code: "errors.tasks.executor-unavailable",
          retryable: false,
        });
      const result = await executor({
        taskId: createTaskId(run.taskId),
        runId: createRunId(run.runId),
        attempt: run.attempt,
        signal: controller.signal,
        correlationId: createCorrelationId(run.correlationId),
      });
      if (controller.signal.aborted)
        await transition(run, "cancelled", {
          errorCode: "errors.tasks.cancelled",
          retryable: false,
        });
      else await transition(run, "succeeded", { summary: result?.summary });
    } catch (caught) {
      const error = asError(caught);
      if (controller.signal.aborted || error.name === "AbortError")
        await transition(run, "cancelled", {
          errorCode: "errors.tasks.cancelled",
          retryable: false,
        });
      else if (error.retryable && run.attempt <= definition.retry.maxAttempts) {
        const delay =
          (definition.retry.backoffSeconds[
            Math.min(
              run.attempt - 1,
              definition.retry.backoffSeconds.length - 1,
            )
          ] ?? 0) * 1000;
        const jittered = Math.round(
          delay * (1 + stableJitter(run.runId, run.attempt) * 0.1),
        );
        const retryRun = await transition(run, "failed", {
          errorCode: taskErrorCode(error),
          retryable: true,
        });
        setTimer(() => {
          void (async () => {
            const queued = await transition(retryRun, "queued", {
              attempt: retryRun.attempt + 1,
              queuedAt: nowIso(),
            });
            queue.push({ run: queued, definition, priority: definition.queue });
            await drain();
          })();
        }, jittered);
      } else
        await transition(run, "failed", {
          errorCode: taskErrorCode(error),
          retryable: Boolean(error.retryable),
        });
    } finally {
      clearTimer(timeoutTimer);
      releaseHeavy?.();
      active.delete(run.taskId);
    }
  };

  const enabled = (taskId: string, preference: TaskPreference | undefined) =>
    preference?.enabled ?? DEFAULT_ENABLED_TASK_IDS.has(taskId);

  const isDue = async (
    definition: JobTypeDefinition,
    preference: TaskPreference | undefined,
    now: Date,
  ): Promise<boolean> => {
    if (!enabled(definition.id, preference)) return false;
    const schedule = effectiveSchedule(definition, preference);
    const recentlyScheduled = lastScheduledAt.get(definition.id);
    if (recentlyScheduled && nextRunAt(schedule, recentlyScheduled) > now)
      return false;
    const runs = await withRuns(() =>
      options.runs.list({ taskId: definition.id }),
    );
    return isScheduleDue(schedule, lastSuccessfulFinishedAt(runs), now);
  };

  const scheduleNext = async () => {
    if (!started) return;
    if (timer !== undefined) clearTimer(timer);
    let soonest: Date | undefined;
    for (const definition of catalog) {
      const preference = await options.preferences.get(definition.id);
      if (!enabled(definition.id, preference)) continue;
      const schedule = effectiveSchedule(definition, preference);
      const runs = await withRuns(() =>
        options.runs.list({ taskId: definition.id }),
      );
      const lastSuccess = lastSuccessfulFinishedAt(runs);
      const scheduled = lastScheduledAt.get(definition.id);
      const base =
        scheduled && (!lastSuccess || scheduled > lastSuccess)
          ? scheduled
          : lastSuccess;
      // A never-successful enabled task is intentionally scheduled promptly;
      // the wake handler records a dispatch timestamp before it re-arms.
      const candidate = base ? nextRunAt(schedule, base) : clock.now();
      if (!soonest || candidate < soonest) soonest = candidate;
    }
    if (soonest)
      timer = setTimer(
        () => {
          void (async () => {
            if (!started) return;
            const now = clock.now();
            for (const definition of catalog) {
              if (!started) return;
              const id = createTaskId(definition.id);
              const preference = await options.preferences.get(id);
              if (!started) return;
              if (await isDue(definition, preference, now)) {
                lastScheduledAt.set(definition.id, now);
                await runNow({ taskId: id, reason: "schedule" });
              }
            }
            await scheduleNext();
          })();
        },
        Math.max(0, soonest.getTime() - clock.now().getTime()),
      );
  };

  const runNow = async ({
    taskId,
    reason,
  }: {
    taskId: TaskId;
    reason: SchedulerReason;
  }): Promise<JobRun> => {
    const definition = definitionFor(taskId);
    if (!definition) throw new TypeError("Unknown task id");
    if (definition.constraints.singleFlight) {
      const existing =
        active.get(taskId)?.run ??
        queue.find((item) => item.run.taskId === taskId)?.run;
      if (existing)
        return append({
          ...existing,
          runId: createRunId(`skip-${++sequence}`),
          status: "skipped",
          trigger: reason === "startup" ? "startup-recovery" : reason,
          finishedAt: nowIso(),
          attempt: existing.attempt,
          summary: { skippedReason: "already-running" },
        });
    }
    const queuedCount = queue.length;
    if (queuedCount >= maxQueueSize && reason !== "manual")
      return append({
        runId: createRunId(`skip-${++sequence}`),
        taskId,
        trigger: reason === "startup" ? "startup-recovery" : reason,
        status: "skipped",
        queuedAt: nowIso(),
        finishedAt: nowIso(),
        attempt: 1,
        correlationId: createCorrelationId(`corr-${sequence}`),
        summary: { skippedReason: "queue-full" },
      });
    const trigger = reason === "startup" ? "startup-recovery" : reason;
    const run: JobRun = {
      runId: createRunId(`run-${++sequence}`),
      taskId,
      trigger,
      status: "queued",
      queuedAt: nowIso(),
      attempt: 1,
      correlationId: createCorrelationId(`corr-${sequence}`),
    };
    await append(run);
    queue.push({
      run,
      definition,
      priority: reason === "manual" ? "interactive" : definition.queue,
    });
    await drain();
    return run;
  };

  return {
    async start() {
      if (started) return;
      started = true;
      await withRuns(() => options.runs.recoverRunning());
      const now = clock.now();
      for (const definition of catalog) {
        if (definition.startupPolicy !== "if-stale") continue;
        const taskId = createTaskId(definition.id);
        const preference = await options.preferences.get(taskId);
        if (await isDue(definition, preference, now)) {
          lastScheduledAt.set(definition.id, now);
          await runNow({ taskId, reason: "startup" });
        }
      }
      await scheduleNext();
    },
    async stop() {
      started = false;
      if (timer !== undefined) {
        clearTimer(timer);
        timer = undefined;
      }
      // Do not start queued background work while shutdown waits for an
      // already-running collector to acknowledge its abort signal.
      queue.length = 0;
      for (const item of active.values()) item.controller.abort();
      await Promise.allSettled([...activeExecutions]);
    },
    runNow,
    async cancel(runId) {
      const queued = queue.findIndex((item) => item.run.runId === runId);
      if (queued >= 0) {
        const [item] = queue.splice(queued, 1);
        if (item)
          await transition(item.run, "cancelled", {
            errorCode: "errors.tasks.cancelled",
            retryable: false,
          });
        return;
      }
      for (const item of active.values())
        if (item.run.runId === runId) {
          item.controller.abort();
          return;
        }
    },
    getNextRunAt(taskId, from = clock.now()) {
      const definition = definitionFor(taskId);
      return definition
        ? nextRunAt(definition.defaultSchedule as Schedule, from)
        : undefined;
    },
  };
}
