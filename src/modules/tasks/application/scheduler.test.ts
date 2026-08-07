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

test("calculates interval, daily and weekly schedules in local time", () => {
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
        await new Promise(() => undefined);
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
