import assert from "node:assert/strict";
import test from "node:test";
import { createTaskApi } from "./task-api.ts";
import type {
  TaskPreferenceRepository,
  TaskRunRepository,
  JobRun,
} from "./task-storage.ts";
import { JOB_DEFINITIONS } from "../definitions/job-catalog.generated.ts";
import type { TaskScheduler } from "./scheduler.ts";

const run = (overrides: Partial<JobRun> = {}): JobRun => ({
  runId: "run-1",
  taskId: "usage.refresh",
  trigger: "manual",
  status: "succeeded",
  queuedAt: "2026-08-07T00:00:00.000Z",
  finishedAt: "2026-08-07T00:00:01.000Z",
  attempt: 1,
  correlationId: "corr-1",
  inputFingerprint: "secret-input",
  outputRef: "secret-output",
  summary: { scanned: 1 },
  ...overrides,
});

function fixtures() {
  const preferences: TaskPreferenceRepository = {
    async read() {
      return {
        schemaVersion: 2,
        updatedAt: "2026-08-07T00:00:00.000Z",
        tasks: {},
      };
    },
    async get() {
      return undefined;
    },
    async save() {},
    async set(_taskId, preference) {
      return {
        schemaVersion: 2,
        updatedAt: "2026-08-07T00:00:00.000Z",
        tasks: { "usage.refresh": preference },
      };
    },
  };
  const runs: TaskRunRepository = {
    async append() {},
    async list() {
      return [run()];
    },
    async recoverRunning() {
      return [];
    },
    async compact() {},
    async rotate() {},
  };
  const scheduler: Pick<TaskScheduler, "runNow" | "cancel"> &
    Partial<Pick<TaskScheduler, "refresh">> = {
    async runNow() {
      return run({ status: "queued" });
    },
    async cancel() {},
  };
  return { preferences, runs, scheduler };
}

test("task definitions are public projections without executor keys", async () => {
  const f = fixtures();
  const result = await createTaskApi(f).listDefinitions();
  assert.equal(result.ok, true);
  assert.equal(result.value.length, JOB_DEFINITIONS.length);
  assert.equal("executorKey" in result.value[0]!, false);
});

test("unknown task and unsafe schedule are rejected", async () => {
  const f = fixtures();
  const api = createTaskApi(f);
  const unknown = await api.runNow({ taskId: "../../etc/passwd" });
  assert.equal(unknown.ok, false);
  if (unknown.ok) throw new Error("expected unknown task failure");
  assert.equal(unknown.error.code, "errors.tasks.unknownTask");
  const schedule = await api.updatePreference({
    taskId: "usage.refresh",
    enabled: true,
    schedule: { kind: "interval", minutes: 1441 },
  });
  assert.equal(schedule.ok, false);
  if (schedule.ok) throw new Error("expected schedule failure");
  assert.equal(schedule.error.code, "errors.tasks.invalidSchedule");
  const unsafe = await api.updatePreference({
    taskId: "usage.refresh",
    enabled: true,
    executor: "rm -rf /",
  });
  assert.equal(unsafe.ok, false);
  if (unsafe.ok) throw new Error("expected unsafe input failure");
  assert.equal(unsafe.error.code, "errors.tasks.invalidInput");
});

test("updatePreference accepts a monthly schedule for reports.generate", async () => {
  const api = createTaskApi(fixtures());
  const result = await api.updatePreference({
    taskId: "reports.generate",
    enabled: true,
    schedule: { kind: "monthly", dayOfMonth: 15, localTime: "09:00" },
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected monthly schedule acceptance");
  assert.deepEqual(result.value, {
    taskId: "reports.generate",
    enabled: true,
    schedule: { kind: "monthly", dayOfMonth: 15, localTime: "09:00" },
  });
});

test("updatePreference refreshes a running scheduler after persistence", async () => {
  const f = fixtures();
  let refreshed = 0;
  f.scheduler = {
    ...f.scheduler,
    refresh: async () => {
      refreshed += 1;
    },
  };
  const result = await createTaskApi(f).updatePreference({
    taskId: "reports.generate",
    enabled: true,
    schedule: { kind: "daily", localTime: "18:30" },
  });
  assert.equal(result.ok, true);
  assert.equal(refreshed, 1);
});

test("manual run and cancellation delegate through controlled identifiers", async () => {
  const f = fixtures();
  let cancelled = "";
  f.scheduler.cancel = async (runId: string) => {
    cancelled = String(runId);
  };
  const api = createTaskApi(f);
  const started = await api.runNow({ taskId: "usage.refresh" });
  assert.equal(started.ok, true);
  assert.equal(started.value.taskId, "usage.refresh");
  const cancelledResult = await api.cancel({ runId: "run-1" });
  assert.deepEqual(cancelledResult, { ok: true, value: { runId: "run-1" } });
  assert.equal(cancelled, "run-1");
  const invalidCancel = await api.cancel({ runId: "../secrets" });
  assert.equal(invalidCancel.ok, false);
  if (invalidCancel.ok) throw new Error("expected invalid run failure");
  assert.equal(invalidCancel.error.code, "errors.tasks.invalidRunId");
});

test("history projection excludes correlation and executor-owned references", async () => {
  const result = await createTaskApi(fixtures()).listRuns();
  assert.equal(result.ok, true);
  const item = result.value[0]!;
  assert.equal("correlationId" in item, false);
  assert.equal("inputFingerprint" in item, false);
  assert.equal("outputRef" in item, false);
});
