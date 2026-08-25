import assert from "node:assert/strict";
import test from "node:test";
import { createTaskId } from "../../../shared/ids.ts";
import { JOB_DEFINITIONS } from "../definitions/job-catalog.generated.ts";
import type {
  TaskPreferenceRepository,
  TaskRunRepository,
  TaskPreferencesFile,
  JobRun,
} from "./task-storage.ts";
import {
  createTaskScheduler,
  effectiveSchedule,
  isScheduleDue,
  lastSuccessfulFinishedAt,
  nextRunAt,
  prioritizeStartupDefinitions,
  TaskSchedulerStartupError,
  type SchedulerOptions,
} from "./scheduler.ts";

const STARTUP_TASK_IDS = new Set([
  "usage.refresh",
  "sessions.refresh",
  "skills.refresh",
  "installation.refresh",
  "exchange.refresh",
]);

function startupCatalog() {
  return JOB_DEFINITIONS.filter((definition) =>
    STARTUP_TASK_IDS.has(definition.id),
  );
}

function successfulStartupExecutors(
  onStart?: (taskId: string) => void,
): NonNullable<SchedulerOptions["executors"]> {
  return {
    "refresh-usage-v1": async () => onStart?.("usage.refresh"),
    "refresh-sessions-v1": async () => onStart?.("sessions.refresh"),
    "refresh-skills-v1": async () => onStart?.("skills.refresh"),
    "refresh-installation-v1": async () => onStart?.("installation.refresh"),
    "refresh-exchange-v1": async () => onStart?.("exchange.refresh"),
  };
}

function harness() {
  const runs: JobRun[] = [];
  const preferences: TaskPreferencesFile = {
    schemaVersion: 2,
    updatedAt: new Date(0).toISOString(),
    tasks: {},
  };
  const repository: TaskRunRepository = {
    append: async (run) => {
      runs.push(run);
    },
    list: async (options) =>
      [...runs]
        .reverse()
        .filter((run) => !options?.taskId || run.taskId === options.taskId),
    recoverRunning: async () => [],
    compact: async () => undefined,
    rotate: async () => undefined,
  };
  const prefs: TaskPreferenceRepository = {
    read: async () => preferences,
    get: async (taskId) => preferences.tasks[taskId],
    save: async () => undefined,
    set: async (taskId, value) => {
      preferences.tasks[taskId] = value;
      return preferences;
    },
  };
  return { runs, prefs, repository };
}

test("defaults installation refresh on and excludes duplicate security scheduling", async () => {
  assert.equal(
    JOB_DEFINITIONS.some((definition) => definition.id === "security.monitor"),
    false,
  );
  const installation = JOB_DEFINITIONS.find(
    (definition) => definition.id === "installation.refresh",
  );
  assert.ok(installation);
  const h = harness();
  let calls = 0;
  const scheduler = createTaskScheduler({
    preferences: h.prefs,
    runs: h.repository,
    catalog: [installation],
    executors: {
      "refresh-installation-v1": async () => {
        calls += 1;
      },
    },
  });
  await scheduler.start();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  await scheduler.stop();
});

test("startup does not resolve before all initial collectors are terminal", async () => {
  const h = harness();
  let releaseUsage!: () => void;
  const usageGate = new Promise<void>((resolve) => {
    releaseUsage = resolve;
  });
  let settled = false;
  const scheduler = createTaskScheduler({
    preferences: h.prefs,
    runs: h.repository,
    catalog: startupCatalog(),
    executors: {
      ...successfulStartupExecutors(),
      "refresh-usage-v1": async () => usageGate,
    },
  });

  const starting = scheduler.start().then(() => {
    settled = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, false);

  releaseUsage();
  await starting;
  assert.equal(settled, true);
  await scheduler.stop();
});

test("an existing snapshot refresh does not extend the startup barrier", async () => {
  const h = harness();
  let releaseUsage!: () => void;
  const usageGate = new Promise<void>((resolve) => {
    releaseUsage = resolve;
  });
  let usageCompleted = false;
  const scheduler = createTaskScheduler({
    preferences: h.prefs,
    runs: h.repository,
    catalog: startupCatalog(),
    shouldAwaitStartupTask: (definition) => definition.id !== "usage.refresh",
    executors: {
      ...successfulStartupExecutors(),
      "refresh-usage-v1": async () => {
        await usageGate;
        usageCompleted = true;
      },
    },
  });

  await scheduler.start();
  assert.equal(usageCompleted, false);

  releaseUsage();
  await scheduler.stop();
  assert.equal(usageCompleted, true);
});

test("startup resolves after all required collectors succeed", async () => {
  const h = harness();
  const scheduler = createTaskScheduler({
    preferences: h.prefs,
    runs: h.repository,
    catalog: startupCatalog(),
    executors: successfulStartupExecutors(),
  });

  await scheduler.start();
  assert.deepEqual(
    h.runs
      .filter(
        (run) =>
          run.trigger === "startup-recovery" && run.status === "succeeded",
      )
      .map((run) => run.taskId)
      .sort(),
    [
      "exchange.refresh",
      "installation.refresh",
      "sessions.refresh",
      "skills.refresh",
      "usage.refresh",
    ],
  );
  await scheduler.stop();
});

test("startup is idempotent across concurrent and repeated calls", async () => {
  const h = harness();
  let calls = 0;
  const installation = JOB_DEFINITIONS.find(
    (definition) => definition.id === "installation.refresh",
  );
  assert.ok(installation);
  const scheduler = createTaskScheduler({
    preferences: h.prefs,
    runs: h.repository,
    catalog: [installation],
    executors: {
      "refresh-installation-v1": async () => {
        calls += 1;
      },
    },
  });

  await Promise.all([scheduler.start(), scheduler.start(), scheduler.start()]);
  await scheduler.start();
  assert.equal(calls, 1);
  await scheduler.stop();
});

test("startup rejects with a stable code when a required collector fails", async () => {
  const h = harness();
  const scheduler = createTaskScheduler({
    preferences: h.prefs,
    runs: h.repository,
    catalog: startupCatalog(),
    executors: {
      ...successfulStartupExecutors(),
      "refresh-usage-v1": async () => {
        throw Object.assign(new Error("/Users/alice/private-token"), {
          code: "errors.tasks.failed",
        });
      },
    },
  });

  await assert.rejects(scheduler.start(), (error: unknown) => {
    assert.ok(error instanceof TaskSchedulerStartupError);
    assert.equal(error.code, "errors.tasks.startup-failed");
    assert.equal(error.message.includes("/Users/alice"), false);
    return true;
  });
  await scheduler.stop();
});

test("a failed startup can retry the same scheduler and reruns the failed task", async () => {
  const h = harness();
  let attempts = 0;
  const installation = JOB_DEFINITIONS.find(
    (definition) => definition.id === "installation.refresh",
  );
  assert.ok(installation);
  const scheduler = createTaskScheduler({
    preferences: h.prefs,
    runs: h.repository,
    catalog: [installation],
    executors: {
      "refresh-installation-v1": async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("first startup fails");
      },
    },
  });

  await assert.rejects(scheduler.start(), TaskSchedulerStartupError);
  await scheduler.start();

  assert.equal(attempts, 2);
  assert.equal(
    h.runs.filter(
      (run) =>
        run.taskId === "installation.refresh" && run.status === "running",
    ).length,
    2,
  );
  await scheduler.stop();
});

test("stop settles a pending startup and allows a fresh start", async () => {
  const h = harness();
  let attempts = 0;
  let firstStarted!: () => void;
  const firstStartedPromise = new Promise<void>((resolve) => {
    firstStarted = resolve;
  });
  const installation = JOB_DEFINITIONS.find(
    (definition) => definition.id === "installation.refresh",
  );
  assert.ok(installation);
  const scheduler = createTaskScheduler({
    preferences: h.prefs,
    runs: h.repository,
    catalog: [installation],
    executors: {
      "refresh-installation-v1": async ({ signal }) => {
        attempts += 1;
        if (attempts !== 1) return;
        firstStarted();
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
      },
    },
  });

  const starting = scheduler.start();
  const rejected = assert.rejects(starting, TaskSchedulerStartupError);
  await firstStartedPromise;
  await scheduler.stop();
  await rejected;

  await scheduler.start();
  assert.equal(attempts, 2);
  await scheduler.stop();
});

test("exchange startup failure does not reject and does not wait for delayed retry", async () => {
  const h = harness();
  const delays: number[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let timerSequence = 0;
  const scheduleTimer: NonNullable<SchedulerOptions["setTimeout"]> = (
    handler,
    delay,
  ) => {
    void handler;
    delays.push(delay);
    const timer = { id: ++timerSequence } as unknown as ReturnType<
      typeof setTimeout
    >;
    timers.add(timer);
    return timer;
  };
  const clearScheduleTimer: NonNullable<SchedulerOptions["clearTimeout"]> = (
    timer,
  ) => {
    timers.delete(timer);
    clearTimeout(timer);
  };
  let exchangeAttempts = 0;
  const scheduler = createTaskScheduler({
    preferences: h.prefs,
    runs: h.repository,
    catalog: startupCatalog(),
    setTimeout: scheduleTimer,
    clearTimeout: clearScheduleTimer,
    executors: {
      ...successfulStartupExecutors(),
      "refresh-exchange-v1": async () => {
        exchangeAttempts += 1;
        throw Object.assign(new Error("/Users/alice/rates"), {
          code: "errors.tasks.network-failed",
          retryable: true,
        });
      },
    },
  });

  await scheduler.start();
  assert.equal(exchangeAttempts, 1);
  assert.equal(
    delays.some((delay) => delay >= 300_000),
    true,
  );
  assert.equal(
    h.runs.some(
      (run) => run.taskId === "exchange.refresh" && run.status === "failed",
    ),
    true,
  );
  await scheduler.stop();
  timers.clear();
});

test("startup executes collectors in the existing startup priority order", async () => {
  const h = harness();
  const order: string[] = [];
  let heavyTail = Promise.resolve();
  const budget = {
    acquire: async () => {
      const previous = heavyTail;
      let release!: () => void;
      heavyTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      return release;
    },
  };
  const scheduler = createTaskScheduler({
    preferences: h.prefs,
    runs: h.repository,
    catalog: startupCatalog(),
    resourceBudget: budget,
    executors: successfulStartupExecutors((taskId) => order.push(taskId)),
  });

  await scheduler.start();
  assert.deepEqual(order, [
    "usage.refresh",
    "sessions.refresh",
    "skills.refresh",
    "installation.refresh",
    "exchange.refresh",
  ]);
  await scheduler.stop();
});

test("calculates interval, daily, weekly and monthly schedules in local time", () => {
  const from = new Date(2026, 0, 5, 10, 0);
  assert.equal(
    nextRunAt({ kind: "interval", minutes: 5 }, from).getTime(),
    from.getTime() + 300_000,
  );
  assert.equal(
    nextRunAt({ kind: "daily", localTime: "09:00" }, from).getDate(),
    6,
  );
  assert.equal(
    nextRunAt(
      { kind: "weekly", weekday: 1, localTime: "11:00" },
      from,
    ).getDate(),
    5,
  );
  // Monthly: same day later in the month (from is Jan 5).
  assert.equal(
    nextRunAt(
      { kind: "monthly", dayOfMonth: 15, localTime: "09:00" },
      from,
    ).getDate(),
    15,
  );
});

test("monthly schedules roll to the next month and clamp short months", () => {
  const monthly = {
    kind: "monthly",
    dayOfMonth: 15,
    localTime: "09:00",
  } as const;
  // Candidate is already in the past → next month, same clamped day.
  const from = new Date(2026, 0, 15, 10, 0);
  const next = nextRunAt(monthly, from);
  assert.equal(next.getMonth(), 1); // February
  assert.equal(next.getDate(), 15);
  assert.equal(next.getHours(), 9);

  // dayOfMonth 31 from a 31-day month rolls to the last day of the next
  // (short) month — 2026 is not a leap year, so February has 28 days.
  const fromJan31 = new Date(2026, 0, 31, 10, 0);
  const afterJan31 = nextRunAt(
    { kind: "monthly", dayOfMonth: 31, localTime: "09:00" },
    fromJan31,
  );
  assert.equal(afterJan31.getMonth(), 1); // February
  assert.equal(afterJan31.getDate(), 28);

  // From within a short month the 31st lands on the last day of that month
  // when it is still in the future, then rolls forward with clamping.
  const fromFeb28 = new Date(2026, 1, 28, 10, 0);
  const clamped = nextRunAt(
    { kind: "monthly", dayOfMonth: 31, localTime: "09:00" },
    fromFeb28,
  );
  assert.equal(clamped.getMonth(), 2); // March
  assert.equal(clamped.getDate(), 31);
});

test("uses the effective schedule and last successful completion for freshness", () => {
  const definition = {
    id: "usage.refresh",
    defaultSchedule: { kind: "interval", minutes: 15 },
  } as Parameters<typeof effectiveSchedule>[0];
  const schedule = effectiveSchedule(definition, {
    enabled: true,
    schedule: { kind: "interval", minutes: 60 },
  });
  assert.deepEqual(schedule, { kind: "interval", minutes: 60 });

  const last = lastSuccessfulFinishedAt([
    {
      runId: "run:failed",
      taskId: "usage.refresh",
      trigger: "schedule",
      status: "failed",
      attempt: 1,
      correlationId: "corr:failed",
      finishedAt: "2026-08-10T09:55:00.000Z",
    },
    {
      runId: "run:success",
      taskId: "usage.refresh",
      trigger: "schedule",
      status: "succeeded",
      attempt: 1,
      correlationId: "corr:success",
      finishedAt: "2026-08-10T09:00:00.000Z",
    },
  ]);
  assert.equal(last?.toISOString(), "2026-08-10T09:00:00.000Z");
  assert.equal(
    isScheduleDue(schedule, last, new Date("2026-08-10T09:59:59.000Z")),
    false,
  );
  assert.equal(
    isScheduleDue(schedule, last, new Date("2026-08-10T10:00:00.000Z")),
    true,
  );
});

test("enforces single flight and records a skipped run", async () => {
  const h = harness();
  let resolve!: () => void;
  const pending = new Promise<void>((r) => {
    resolve = r;
  });
  const scheduler = createTaskScheduler({
    preferences: h.prefs,
    runs: h.repository,
    executors: {
      "refresh-usage-v1": async () => {
        await pending;
      },
    },
  });
  const first = await scheduler.runNow({
    taskId: createTaskId("usage.refresh"),
    reason: "manual",
  });
  const second = await scheduler.runNow({
    taskId: createTaskId("usage.refresh"),
    reason: "manual",
  });
  assert.equal(first.status, "queued");
  assert.equal(second.status, "skipped");
  resolve();
});

test("cancels a running executor through AbortSignal", async () => {
  const h = harness();
  let signal!: AbortSignal;
  const scheduler = createTaskScheduler({
    preferences: h.prefs,
    runs: h.repository,
    executors: {
      "refresh-usage-v1": async (context) => {
        signal = context.signal;
        await new Promise<void>((resolve) =>
          context.signal.addEventListener("abort", () => resolve(), {
            once: true,
          }),
        );
      },
    },
  });
  const run = await scheduler.runNow({
    taskId: createTaskId("usage.refresh"),
    reason: "manual",
  });
  await new Promise((resolve) => setImmediate(resolve));
  await scheduler.cancel(run.runId);
  assert.equal(signal.aborted, true);
});

test("startup performs abandoned-run recovery before scheduling", async () => {
  const h = harness();
  let recoveries = 0;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const scheduleTimer: NonNullable<SchedulerOptions["setTimeout"]> = (
    handler,
    delay,
  ) => {
    const timer = setTimeout(handler, delay);
    timers.push(timer);
    (timer as unknown as { unref?: () => void }).unref?.();
    return timer;
  };
  const scheduler = createTaskScheduler({
    preferences: h.prefs,
    runs: {
      ...h.repository,
      recoverRunning: async () => {
        recoveries += 1;
        return [];
      },
    },
    catalog: [],
    setTimeout: scheduleTimer,
  });
  await scheduler.start();
  assert.equal(recoveries, 1);
  await scheduler.stop();
  timers.forEach((timer) => clearTimeout(timer));
});

test("startup prioritizes local workspace snapshots ahead of exchange refresh", () => {
  const startupIds = prioritizeStartupDefinitions(JOB_DEFINITIONS)
    .filter((definition) => definition.startupPolicy === "if-stale")
    .map((definition) => definition.id);

  assert.deepEqual(startupIds.slice(0, 5), [
    "usage.refresh",
    "sessions.refresh",
    "skills.refresh",
    "installation.refresh",
    "exchange.refresh",
  ]);
});

test("does not expose execution error details in JobRun", async () => {
  const h = harness();
  const scheduler = createTaskScheduler({
    preferences: h.prefs,
    runs: h.repository,
    executors: {
      "refresh-usage-v1": async () => {
        throw Object.assign(new Error("/Users/alice/token=secret"), {
          code: "errors.tasks.failed",
        });
      },
    },
  });
  await scheduler.runNow({
    taskId: createTaskId("usage.refresh"),
    reason: "manual",
  });
  for (
    let attempt = 0;
    attempt < 20 && !h.runs.some((run) => run.status === "failed");
    attempt++
  )
    await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(
    h.runs.some((run) => run.status === "failed"),
    true,
  );
  assert.equal(JSON.stringify(h.runs).includes("/Users/alice"), false);
  assert.equal(JSON.stringify(h.runs).includes("secret"), false);
});

test("T5-06: heavy collectors share the global heavy permit (max 1 concurrent)", async () => {
  const h = harness();
  let activeHeavy = 0;
  let peakHeavy = 0;
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  // A counting resource budget that tracks heavy concurrency.
  let heavyInFlight = 0;
  const budget = {
    async acquire(resource: "heavy" | "file" | "classifier") {
      if (resource !== "heavy") return () => undefined;
      while (heavyInFlight >= 1) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      heavyInFlight += 1;
      activeHeavy += 1;
      peakHeavy = Math.max(peakHeavy, activeHeavy);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        activeHeavy -= 1;
        heavyInFlight -= 1;
      };
    },
  };
  const scheduler = createTaskScheduler({
    preferences: h.prefs,
    runs: h.repository,
    resourceBudget: budget,
    executors: {
      "refresh-usage-v1": async () => {
        await firstGate;
      },
      "refresh-sessions-v1": async () => {
        // Would run concurrently with usage if the budget leaked.
        await new Promise((resolve) => setTimeout(resolve, 5));
      },
    },
  });
  const first = await scheduler.runNow({
    taskId: createTaskId("usage.refresh"),
    reason: "manual",
  });
  const second = await scheduler.runNow({
    taskId: createTaskId("sessions.refresh"),
    reason: "manual",
  });
  assert.equal(first.status, "queued");
  assert.equal(second.status, "queued");
  await new Promise((resolve) => setTimeout(resolve, 10));
  // The second heavy task must wait for the first permit.
  assert.equal(activeHeavy, 1);
  assert.equal(peakHeavy, 1);
  releaseFirst();
  await new Promise((resolve) => setTimeout(resolve, 30));
  // Both completed; no permit leaked.
  assert.equal(activeHeavy, 0);
  assert.equal(peakHeavy, 1);
});

test("heavy collector timeout starts only after its permit is acquired", async () => {
  const h = harness();
  let heavyInFlight = false;
  const waiters: Array<() => void> = [];
  const budget = {
    async acquire() {
      if (heavyInFlight) {
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
      heavyInFlight = true;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        heavyInFlight = false;
        waiters.shift()?.();
      };
    },
  };
  const armedTimeouts: number[] = [];
  const liveTimers: Array<ReturnType<typeof setTimeout>> = [];
  let releaseUsage!: () => void;
  const usageGate = new Promise<void>((resolve) => {
    releaseUsage = resolve;
  });
  const scheduler = createTaskScheduler({
    preferences: h.prefs,
    runs: h.repository,
    resourceBudget: budget,
    setTimeout(handler, delay) {
      armedTimeouts.push(delay);
      const timer = setTimeout(handler, delay);
      liveTimers.push(timer);
      return timer;
    },
    executors: {
      "refresh-usage-v1": async () => usageGate,
      "refresh-installation-v1": async () => undefined,
    },
  });

  await scheduler.runNow({
    taskId: createTaskId("usage.refresh"),
    reason: "manual",
  });
  await scheduler.runNow({
    taskId: createTaskId("installation.refresh"),
    reason: "manual",
  });
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(armedTimeouts, [120_000]);
  releaseUsage();
  for (
    let attempt = 0;
    attempt < 20 && armedTimeouts.length < 2;
    attempt += 1
  ) {
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
  assert.deepEqual(armedTimeouts, [120_000, 60_000]);
  assert.equal(
    h.runs.some(
      (run) =>
        run.taskId === "installation.refresh" && run.status === "succeeded",
    ),
    true,
  );

  await scheduler.stop();
  for (const timer of liveTimers) clearTimeout(timer);
});

test("T5-06: cancelled heavy task releases its permit (no leak)", async () => {
  const h = harness();
  let permits = 0;
  let released = 0;
  const budget = {
    async acquire() {
      permits += 1;
      let done = false;
      return () => {
        if (!done) {
          done = true;
          released += 1;
        }
      };
    },
  };
  const scheduler = createTaskScheduler({
    preferences: h.prefs,
    runs: h.repository,
    resourceBudget: budget,
    executors: {
      "refresh-usage-v1": async ({ signal }) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        signal.throwIfAborted();
      },
    },
  });
  const run = await scheduler.runNow({
    taskId: createTaskId("usage.refresh"),
    reason: "manual",
  });
  await scheduler.cancel(run.runId);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(permits, 1);
  assert.equal(released, 1); // permit released on cancellation
});
