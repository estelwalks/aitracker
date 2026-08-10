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
  const weekday = schedule.weekday;
  const current = candidate.getDay() === 0 ? 7 : candidate.getDay();
  let delta = (weekday - current + 7) % 7;
  if (delta === 0 && candidate <= from) delta = 7;
  candidate.setDate(candidate.getDate() + delta);
  return candidate;
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
  let sequence = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let started = false;

  const definitionFor = (taskId: TaskId) =>
    catalog.find((item) => item.id === taskId);
  const nowIso = () => clock.now().toISOString();
  const append = async (run: JobRun) => {
    await options.runs.append(run);
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
      void execute(running, item.definition, controller).finally(() => {
        void drain();
      });
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
          errorCode: error.code ?? "errors.tasks.execution-failed",
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
          errorCode: error.code ?? "errors.tasks.execution-failed",
          retryable: Boolean(error.retryable),
        });
    } finally {
      clearTimer(timeoutTimer);
      active.delete(run.taskId);
    }
  };

  const scheduleNext = () => {
    if (!started) return;
    if (timer !== undefined) clearTimer(timer);
    let soonest: Date | undefined;
    for (const definition of catalog) {
      const taskId = createTaskId(definition.id);
      const preference = undefined; // preferences are read asynchronously on start/run
      void preference;
      const candidate = nextRunAt(
        definition.defaultSchedule as Schedule,
        clock.now(),
      );
      if (!soonest || candidate < soonest) soonest = candidate;
      void taskId;
    }
    if (soonest)
      timer = setTimer(
        () => {
          void (async () => {
            for (const definition of catalog) {
              const id = createTaskId(definition.id);
              const preference = await options.preferences.get(id);
              if (preference?.enabled)
                await runNow({ taskId: id, reason: "schedule" });
            }
            scheduleNext();
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
      await options.runs.recoverRunning();
      scheduleNext();
    },
    async stop() {
      started = false;
      if (timer !== undefined) {
        clearTimer(timer);
        timer = undefined;
      }
      for (const item of active.values()) item.controller.abort();
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
