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

/**
 * Durable per-task cursor for calendar schedules, mirroring the security
 * module's persisted schedule runtime. The scheduler remembers the armed
 * occurrence across restarts so a run missed while the server/app was closed
 * catches up on the next start instead of being silently dropped.
 */
export interface CalendarCursor {
  readonly fingerprint: string;
  readonly nextRunAt: string;
}

export interface CalendarCursorStore {
  read(): Promise<Readonly<Record<string, CalendarCursor>>>;
  write(cursors: Readonly<Record<string, CalendarCursor>>): Promise<void>;
}

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
   * Decides whether a due startup refresh belongs to the native startup
   * barrier. Defaults to true, preserving the strict existing behavior.
   */
  readonly shouldAwaitStartupTask?: (
    definition: JobTypeDefinition,
  ) => boolean | Promise<boolean>;
  /**
   * Durable cursor store for calendar schedules. When present, the scheduler
   * persists each armed occurrence and catches up overdue ones after a
   * restart (same contract the security scan scheduler uses).
   */
  readonly calendarCursors?: CalendarCursorStore;
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
  /** Re-read persisted preferences and re-arm the shared timer immediately. */
  refresh(): Promise<void>;
  stop(): Promise<void>;
  runNow(request: { taskId: TaskId; reason: SchedulerReason }): Promise<JobRun>;
  cancel(runId: RunId | string): Promise<void>;
  getNextRunAt(taskId: TaskId, from?: Date): Date | undefined;
  /** Whether the shared timer is armed (started and not stopped). */
  isRunning(): boolean;
}

export class TaskSchedulerStartupError extends Error {
  readonly code = "errors.tasks.startup-failed" as const;

  constructor() {
    super("Task scheduler failed to initialize");
    this.name = "TaskSchedulerStartupError";
  }
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
/** Fallback re-arm delay when a scheduler tick or preference read fails. */
const TICK_RETRY_DELAY_MS = 60_000;

/**
 * Stable fingerprint of an armed calendar schedule. Changing the schedule or
 * toggling the task invalidates the stored cursor so a re-enabled or
 * re-timed plan arms fresh instead of catching up on a stale occurrence.
 */
export function calendarScheduleFingerprint(
  schedule: Schedule,
  enabled: boolean,
): string {
  let hash = 2166136261;
  const payload = `${enabled ? "1" : "0"}|${JSON.stringify(schedule)}`;
  for (let index = 0; index < payload.length; index += 1) {
    hash = Math.imul(hash ^ payload.charCodeAt(index), 16777619);
  }
  return (hash >>> 0).toString(16);
}

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

/**
 * The first run competes for one shared heavy-collector permit.  Keep the
 * locally visible workspace data ahead of opportunistic network work so the
 * native startup screen can finish meaningful initialization before the
 * dashboard is shown.  Normal scheduled/manual runs still use their declared
 * queue priority; this order only applies to the startup sweep.
 */
const STARTUP_TASK_ORDER = new Map<string, number>([
  ["usage.refresh", 0],
  ["sessions.refresh", 1],
  ["skills.refresh", 2],
  ["installation.refresh", 3],
  ["exchange.refresh", 4],
]);

const REQUIRED_STARTUP_TASK_IDS = new Set([
  "usage.refresh",
  "sessions.refresh",
  "skills.refresh",
  "installation.refresh",
]);
const STARTUP_BARRIER_TASK_IDS = new Set([
  ...REQUIRED_STARTUP_TASK_IDS,
  "exchange.refresh",
]);

export function prioritizeStartupDefinitions(
  catalog: readonly JobTypeDefinition[],
): JobTypeDefinition[] {
  return [...catalog].sort((left, right) => {
    const leftPriority =
      STARTUP_TASK_ORDER.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightPriority =
      STARTUP_TASK_ORDER.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    return leftPriority - rightPriority;
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
  const activeExecutions = new Set<Promise<void>>();
  let sequence = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let started = false;
  let startPromise: Promise<void> | undefined;
  let lifecycle = 0;
  const retryTimers = new Set<ReturnType<typeof setTimeout>>();
  // A successful terminal record is the source of truth for freshness. This
  // small in-memory guard merely prevents a slow/failed task from repeatedly
  // being enqueued while its last success remains stale.
  const lastScheduledAt = new Map<string, Date>();
  const startupCompletions = new Map<
    string,
    {
      readonly promise: Promise<JobRun>;
      readonly resolve: (run: JobRun) => void;
      settled?: JobRun;
    }
  >();

  const createStartupCompletion = (runId: string) => {
    let resolve!: (run: JobRun) => void;
    const promise = new Promise<JobRun>((settle) => {
      resolve = settle;
    });
    const completion = { promise, resolve };
    startupCompletions.set(runId, completion);
    return completion;
  };

  const settleStartupCompletion = (run: JobRun) => {
    const completion = startupCompletions.get(run.runId);
    if (!completion || completion.settled) return;
    completion.settled = run;
    completion.resolve(run);
  };

  const definitionFor = (taskId: TaskId) =>
    catalog.find((item) => item.id === taskId);
  const nowIso = () => clock.now().toISOString();
  // Scheduler transitions are asynchronous, so serialize this runtime's own
  // accesses instead of turning a completion + scheduling read into a failed
  // listener.
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
  ) => {
    const transitioned = await append({
      ...run,
      status,
      ...extra,
      ...(TERMINAL.has(status) ? { finishedAt: nowIso() } : {}),
    });
    if (TERMINAL.has(status)) settleStartupCompletion(transitioned);
    return transitioned;
  };

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
    // P5-T5-06: heavy collectors (category "collection") share the global
    // heavy permit; the release is idempotent and always runs, so cancelled
    // or failed tasks can never leak a permit. Manual triggers raise queue
    // priority (runNow) but never bypass this budget.
    const isHeavy = definition.category === "collection";
    let releaseHeavy: (() => void) | undefined;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Queue time is governed by the shared resource budget and must not
      // consume a task's execution budget. On first launch all collectors are
      // queued together; starting every timer here previously cancelled the
      // 60-second installation task while it was still waiting behind usage,
      // sessions and skills.
      if (isHeavy && options.resourceBudget) {
        releaseHeavy = await options.resourceBudget.acquire(
          "heavy",
          controller.signal,
        );
      }
      controller.signal.throwIfAborted();
      timeoutTimer = setTimer(() => controller.abort(), definition.timeoutMs);
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
        const retryLifecycle = lifecycle;
        const retryTimer = setTimer(() => {
          retryTimers.delete(retryTimer);
          if (lifecycle !== retryLifecycle) return;
          void (async () => {
            const queued = await transition(retryRun, "queued", {
              attempt: retryRun.attempt + 1,
              queuedAt: nowIso(),
            });
            if (lifecycle !== retryLifecycle) return;
            queue.push({ run: queued, definition, priority: definition.queue });
            await drain();
          })();
        }, jittered);
        retryTimers.add(retryTimer);
      } else
        await transition(run, "failed", {
          errorCode: taskErrorCode(error),
          retryable: Boolean(error.retryable),
        });
    } finally {
      if (timeoutTimer !== undefined) clearTimer(timeoutTimer);
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

  const waitForStartupRun = async (run: JobRun): Promise<JobRun> => {
    if (TERMINAL.has(run.status)) return run;
    const completion = startupCompletions.get(run.runId);
    if (!completion) throw new TaskSchedulerStartupError();
    return completion.settled ?? completion.promise;
  };

  const awaitStartupBarrier = async (
    startupRuns: readonly {
      definition: JobTypeDefinition;
      run: JobRun;
    }[],
  ): Promise<void> => {
    const outcomes = await Promise.allSettled(
      startupRuns.map(async ({ definition, run }) => ({
        definition,
        run: await waitForStartupRun(run),
      })),
    );
    try {
      const requiredFailure = outcomes.some((outcome) => {
        if (outcome.status === "rejected") return true;
        return (
          REQUIRED_STARTUP_TASK_IDS.has(outcome.value.definition.id) &&
          outcome.value.run.status !== "succeeded" &&
          // P2-7: a cancelled startup task (collector timeout / abort) must not
          // take the whole application down with it — the snapshot stays empty
          // and the scheduler retries in the background. Only genuine failures
          // (rejected wait or failed terminal) fail the startup barrier.
          outcome.value.run.status !== "cancelled"
        );
      });
      if (requiredFailure) throw new TaskSchedulerStartupError();
    } finally {
      for (const { run } of startupRuns) startupCompletions.delete(run.runId);
    }
  };

  /**
   * Reads the durable calendar cursors once per re-arm. A failing store must
   * never take the scheduler down: it degrades to no cursors (fresh arms)
   * and the error is surfaced in server diagnostics.
   */
  const readCalendarCursors = async (): Promise<
    Readonly<Record<string, CalendarCursor>>
  > => {
    if (!options.calendarCursors) return {};
    try {
      return await options.calendarCursors.read();
    } catch (error) {
      console.error("[tasks] cannot read calendar cursors", error);
      return {};
    }
  };

  const persistCalendarCursors = async (
    cursors: Readonly<Record<string, CalendarCursor>>,
  ): Promise<void> => {
    if (!options.calendarCursors) return;
    try {
      await options.calendarCursors.write(cursors);
    } catch (error) {
      console.error("[tasks] cannot persist calendar cursors", error);
    }
  };

  const scheduleNext = async (expectedLifecycle = lifecycle) => {
    if (!started || lifecycle !== expectedLifecycle) return;
    if (timer !== undefined) clearTimer(timer);
    let soonest: Date | undefined;
    let sawEnabledTask = false;
    const storedCursors = await readCalendarCursors();
    const nextCursors: Record<string, CalendarCursor> = {
      ...storedCursors,
    };
    let cursorChanged = false;
    for (const definition of catalog) {
      if (!started || lifecycle !== expectedLifecycle) return;
      let preference: TaskPreference | undefined;
      try {
        preference = await options.preferences.get(definition.id);
      } catch (error) {
        console.error(
          `[tasks] cannot read preference for ${definition.id}`,
          error,
        );
        continue;
      }
      if (!started || lifecycle !== expectedLifecycle) return;
      if (!enabled(definition.id, preference)) {
        // A disabled calendar task must not keep a stale cursor that could
        // look like an overdue occurrence if it is ever re-enabled.
        if (nextCursors[definition.id] !== undefined) {
          delete nextCursors[definition.id];
          cursorChanged = true;
        }
        continue;
      }
      sawEnabledTask = true;
      const schedule = effectiveSchedule(definition, preference);
      let runs: readonly JobRun[] = [];
      try {
        runs = await withRuns(() =>
          options.runs.list({ taskId: definition.id }),
        );
      } catch (error) {
        console.error(`[tasks] cannot read runs for ${definition.id}`, error);
        continue;
      }
      if (!started || lifecycle !== expectedLifecycle) return;
      const lastSuccess = lastSuccessfulFinishedAt(runs);
      const scheduled = lastScheduledAt.get(definition.id);
      const base =
        scheduled && (!lastSuccess || scheduled > lastSuccess)
          ? scheduled
          : lastSuccess;
      // Startup collectors without a success run immediately. Calendar tasks
      // whose startup policy is disabled wait for their first configured
      // occurrence instead of firing as soon as the preference is enabled.
      if (schedule.kind === "interval") {
        const candidate = base
          ? nextRunAt(schedule, base)
          : definition.startupPolicy === "disabled"
            ? nextRunAt(schedule, clock.now())
            : clock.now();
        if (!soonest || candidate < soonest) soonest = candidate;
        continue;
      }
      const now = clock.now();
      const fingerprint = calendarScheduleFingerprint(schedule, true);
      const stored = storedCursors[definition.id];
      const firedThisSession = lastScheduledAt.get(definition.id);
      // The persisted arm is authoritative only while the task is genuinely
      // due: a manual run after the armed time makes the occurrence already
      // satisfied, so the cursor advances instead of busy-looping.
      const dueByFreshness =
        lastSuccess === undefined || nextRunAt(schedule, lastSuccess) <= now;
      if (
        stored !== undefined &&
        stored.fingerprint === fingerprint &&
        Date.parse(stored.nextRunAt) <= now.getTime() &&
        dueByFreshness &&
        // A catch-up run already fired for this occurrence in this session;
        // advance the cursor to the next occurrence instead of re-firing.
        (firedThisSession === undefined ||
          firedThisSession.getTime() < Date.parse(stored.nextRunAt))
      ) {
        // A previously armed occurrence is overdue (the server/app was closed
        // at the scheduled time): fire immediately, mirroring the security
        // scan scheduler's persisted-runtime catch-up. The stored cursor is
        // left untouched; the post-run re-arm advances it to the next
        // occurrence.
        soonest = now;
        continue;
      }
      const candidate = base
        ? nextRunAt(schedule, base)
        : nextRunAt(schedule, now);
      const candidateAt = candidate.getTime();
      if (candidateAt > now.getTime()) {
        const armed: CalendarCursor = {
          fingerprint,
          nextRunAt: candidate.toISOString(),
        };
        if (
          stored === undefined ||
          stored.fingerprint !== fingerprint ||
          stored.nextRunAt !== armed.nextRunAt
        ) {
          nextCursors[definition.id] = armed;
          cursorChanged = true;
        }
      }
      if (!soonest || candidate < soonest) soonest = candidate;
    }
    if (cursorChanged) await persistCalendarCursors(nextCursors);
    if (!started || lifecycle !== expectedLifecycle) return;
    if (!soonest && sawEnabledTask) {
      // Enabled tasks exist but every candidate read failed; keep polling so
      // the scheduler recovers once the underlying store does.
      timer = setTimer(() => {
        void tick(expectedLifecycle);
      }, TICK_RETRY_DELAY_MS);
      return;
    }
    if (soonest)
      timer = setTimer(
        () => {
          void tick(expectedLifecycle);
        },
        Math.max(0, soonest.getTime() - clock.now().getTime()),
      );
  };

  /**
   * Shared-timer tick. Per-task read failures skip only that task; any
   * unexpected failure re-arms with a bounded fallback instead of silently
   * stopping all future scheduled runs.
   */
  const tick = async (expectedLifecycle: number): Promise<void> => {
    if (!started || lifecycle !== expectedLifecycle) return;
    const now = clock.now();
    try {
      for (const definition of catalog) {
        if (!started || lifecycle !== expectedLifecycle) return;
        const id = createTaskId(definition.id);
        let preference: TaskPreference | undefined;
        try {
          preference = await options.preferences.get(id);
        } catch (error) {
          console.error(
            `[tasks] tick: cannot read preference for ${definition.id}`,
            error,
          );
          continue;
        }
        if (!started || lifecycle !== expectedLifecycle) return;
        let due = false;
        try {
          due = await isDue(definition, preference, now);
        } catch (error) {
          console.error(
            `[tasks] tick: cannot evaluate ${definition.id}`,
            error,
          );
          continue;
        }
        if (!due) continue;
        if (!started || lifecycle !== expectedLifecycle) return;
        lastScheduledAt.set(definition.id, now);
        try {
          await runNow({ taskId: id, reason: "schedule" });
        } catch (error) {
          // Keep the task due so the fallback re-arm retries it.
          lastScheduledAt.delete(definition.id);
          throw error;
        }
      }
    } catch (error) {
      console.error(
        `[tasks] scheduler tick failed; re-arming in ${TICK_RETRY_DELAY_MS}ms`,
        error,
      );
      if (started && lifecycle === expectedLifecycle)
        timer = setTimer(() => {
          void tick(expectedLifecycle);
        }, TICK_RETRY_DELAY_MS);
      return;
    }
    await scheduleNext(expectedLifecycle);
  };

  const runNow = async (
    {
      taskId,
      reason,
    }: {
      taskId: TaskId;
      reason: SchedulerReason;
    },
    expectedLifecycle?: number,
  ): Promise<JobRun> => {
    if (expectedLifecycle !== undefined && lifecycle !== expectedLifecycle)
      throw new TaskSchedulerStartupError();
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
    const startupCompletion =
      reason === "startup" && STARTUP_BARRIER_TASK_IDS.has(definition.id)
        ? createStartupCompletion(run.runId)
        : undefined;
    try {
      await append(run);
      if (expectedLifecycle !== undefined && lifecycle !== expectedLifecycle) {
        return transition(run, "cancelled", {
          errorCode: "errors.tasks.cancelled",
          retryable: false,
        });
      }
      queue.push({
        run,
        definition,
        priority: reason === "manual" ? "interactive" : definition.queue,
      });
      await drain();
      return run;
    } catch (error) {
      if (startupCompletion) startupCompletions.delete(run.runId);
      throw error;
    }
  };

  const performStart = async (expectedLifecycle: number): Promise<void> => {
    started = true;
    const scheduledByThisStart = new Map<
      string,
      { previous: Date | undefined; scheduled: Date }
    >();
    const assertCurrentStart = () => {
      if (!started || lifecycle !== expectedLifecycle)
        throw new TaskSchedulerStartupError();
    };
    try {
      await withRuns(() => options.runs.recoverRunning());
      assertCurrentStart();
      const now = clock.now();
      const startupRuns: Array<{
        definition: JobTypeDefinition;
        run: JobRun;
      }> = [];
      for (const definition of prioritizeStartupDefinitions(catalog)) {
        assertCurrentStart();
        if (definition.startupPolicy !== "if-stale") continue;
        const taskId = createTaskId(definition.id);
        const preference = await options.preferences.get(taskId);
        assertCurrentStart();
        if (await isDue(definition, preference, now)) {
          assertCurrentStart();
          const shouldAwaitStartupTask =
            STARTUP_BARRIER_TASK_IDS.has(definition.id) &&
            (options.shouldAwaitStartupTask == null ||
              (await options.shouldAwaitStartupTask(definition)));
          assertCurrentStart();
          scheduledByThisStart.set(definition.id, {
            previous: lastScheduledAt.get(definition.id),
            scheduled: now,
          });
          lastScheduledAt.set(definition.id, now);
          const run = await runNow(
            { taskId, reason: "startup" },
            expectedLifecycle,
          );
          assertCurrentStart();
          if (shouldAwaitStartupTask) {
            startupRuns.push({ definition, run });
          } else {
            startupCompletions.delete(run.runId);
          }
        }
      }
      await awaitStartupBarrier(startupRuns);
      assertCurrentStart();
      await scheduleNext(expectedLifecycle);
    } catch {
      for (const [taskId, entry] of scheduledByThisStart) {
        if (lastScheduledAt.get(taskId) !== entry.scheduled) continue;
        if (entry.previous) lastScheduledAt.set(taskId, entry.previous);
        else lastScheduledAt.delete(taskId);
      }
      if (lifecycle === expectedLifecycle) started = false;
      if (timer !== undefined) {
        clearTimer(timer);
        timer = undefined;
      }
      for (const retryTimer of retryTimers) clearTimer(retryTimer);
      retryTimers.clear();
      throw new TaskSchedulerStartupError();
    }
  };

  return {
    async start() {
      if (startPromise) return startPromise;
      if (started) return;
      const expectedLifecycle = ++lifecycle;
      const pending = performStart(expectedLifecycle);
      startPromise = pending;
      void pending.then(
        () => undefined,
        () => {
          if (startPromise === pending) startPromise = undefined;
        },
      );
      return pending;
    },
    async stop() {
      const pendingStart = startPromise;
      started = false;
      lifecycle += 1;
      if (timer !== undefined) {
        clearTimer(timer);
        timer = undefined;
      }
      for (const retryTimer of retryTimers) clearTimer(retryTimer);
      retryTimers.clear();
      // Do not start queued background work while shutdown waits for an
      // already-running collector to acknowledge its abort signal.
      const queued = queue.splice(0);
      await Promise.all(
        queued.map((item) =>
          transition(item.run, "cancelled", {
            errorCode: "errors.tasks.cancelled",
            retryable: false,
          }),
        ),
      );
      for (const item of active.values()) {
        item.controller.abort();
        settleStartupCompletion({
          ...item.run,
          status: "cancelled",
          finishedAt: nowIso(),
          errorCode: "errors.tasks.cancelled",
          retryable: false,
        });
      }
      await Promise.allSettled([
        ...(pendingStart ? [pendingStart] : []),
        ...activeExecutions,
      ]);
      if (startPromise === pendingStart) startPromise = undefined;
    },
    async refresh() {
      const pendingStart = startPromise;
      if (pendingStart) await pendingStart.catch(() => undefined);
      if (!started) return;
      const expectedLifecycle = ++lifecycle;
      if (timer !== undefined) {
        clearTimer(timer);
        timer = undefined;
      }
      await scheduleNext(expectedLifecycle);
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
    isRunning() {
      return started;
    },
  };
}
