import assert from "node:assert/strict";
import test from "node:test";
import { createTaskId } from "../../../shared/ids.ts";
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
  type SchedulerOptions,
} from "./scheduler.ts";

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
    list: async () => [...runs].reverse(),
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
    setTimeout: scheduleTimer,
  });
  await scheduler.start();
  assert.equal(recoveries, 1);
  await scheduler.stop();
  timers.forEach((timer) => clearTimeout(timer));
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
