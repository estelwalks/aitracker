import assert from "node:assert/strict";
import test from "node:test";

import { preferenceSchema, taskRunsSchema } from "./task-storage.ts";

test("preference schema rejects unknown tasks and out-of-range schedules", () => {
  const base = {
    schemaVersion: 2,
    updatedAt: "2026-08-07T00:00:00.000Z",
    tasks: {},
  };
  assert.throws(
    () =>
      preferenceSchema().parse({
        ...base,
        tasks: { "unknown.task": { enabled: true } },
      }),
    TypeError,
  );
  assert.throws(
    () =>
      preferenceSchema().parse({
        ...base,
        tasks: {
          "usage.refresh": {
            enabled: true,
            schedule: { kind: "interval", minutes: 1 },
          },
        },
      }),
    TypeError,
  );
});

test("preference schema accepts a monthly schedule for a report task", () => {
  const parsed = preferenceSchema().parse({
    schemaVersion: 2,
    updatedAt: "2026-08-07T00:00:00.000Z",
    tasks: {
      "reports.generate": {
        enabled: true,
        schedule: { kind: "monthly", dayOfMonth: 15, localTime: "09:00" },
      },
    },
  });
  assert.deepEqual(parsed.tasks["reports.generate"], {
    enabled: true,
    schedule: { kind: "monthly", dayOfMonth: 15, localTime: "09:00" },
  });
  // Out-of-range dayOfMonth is still rejected.
  assert.throws(() =>
    preferenceSchema().parse({
      schemaVersion: 2,
      updatedAt: "2026-08-07T00:00:00.000Z",
      tasks: {
        "reports.generate": {
          enabled: true,
          schedule: { kind: "monthly", dayOfMonth: 32, localTime: "09:00" },
        },
      },
    }),
  );
});

test("preference schema rejects the legacy {updatedAt, tasks} shape", () => {
  assert.throws(() =>
    preferenceSchema().parse({
      updatedAt: "2026-08-07T00:00:00.000Z",
      tasks: {},
    }),
  );
});

test("task runs schema parses valid runs and rejects unknown task ids", () => {
  const validRun = {
    runId: "run:1",
    taskId: "usage.refresh",
    trigger: "manual",
    status: "succeeded",
    attempt: 1,
    correlationId: "corr-1",
  };
  const parsed = taskRunsSchema().parse({ schemaVersion: 1, runs: [validRun] });
  assert.equal(parsed.runs.length, 1);
  assert.equal(parsed.runs[0]?.taskId, "usage.refresh");
  assert.throws(
    () =>
      taskRunsSchema().parse({
        schemaVersion: 1,
        runs: [{ ...validRun, taskId: "unknown.task" }],
      }),
    TypeError,
  );
  // Legacy file shape without a schemaVersion is rejected.
  assert.throws(() => taskRunsSchema().parse({ runs: [validRun] }));
});
