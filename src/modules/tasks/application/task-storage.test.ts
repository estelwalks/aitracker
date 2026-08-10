import assert from "node:assert/strict";
import test from "node:test";
import { APP_ID } from "../../../lib/app-config";

import { NodeAtomicJsonStore } from "../../../platform/persistence/infrastructure/node-atomic-json-store.ts";
import { createTaskPreferenceRepository } from "../infrastructure/task-preference-repository.ts";
import { createTaskRunRepository } from "../infrastructure/task-run-repository.ts";
import {
  DEFAULT_TASK_PREFERENCES,
  DEFAULT_TASK_RUNS,
  preferenceSchema,
  taskRunsSchema,
  type JobRun,
} from "./task-storage.ts";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function temp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), `${APP_ID}-tasks-`));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const clock = { now: () => new Date("2026-08-07T00:00:00.000Z") };
function run(overrides: Partial<JobRun> = {}): JobRun {
  return {
    runId: "run:1",
    taskId: "usage.refresh",
    trigger: "manual",
    status: "running",
    attempt: 1,
    correlationId: "corr-1",
    startedAt: "2026-08-06T23:59:00.000Z",
    ...overrides,
  };
}

test("preferences migrate v1 and reject unknown task or out-of-range schedule", async () => {
  await temp(async (dir) => {
    const path = join(dir, "preferences.json");
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 1,
        data: { tasks: { "usage.refresh": { enabled: true } } },
      }),
    );
    const repository = createTaskPreferenceRepository({
      store: new NodeAtomicJsonStore({
        filePath: path,
        defaultValue: DEFAULT_TASK_PREFERENCES,
        schema: preferenceSchema(clock),
        clock,
      }),
      clock,
    });
    assert.equal(
      (await repository.read()).tasks["usage.refresh"]?.enabled,
      true,
    );
    await assert.rejects(
      repository.set("unknown.task", { enabled: true }),
      TypeError,
    );
    await assert.rejects(
      repository.set("usage.refresh", {
        enabled: true,
        schedule: { kind: "interval", minutes: 1 },
      }),
      TypeError,
    );
  });
});

test("corrupt preferences are backed up and defaulted", async () => {
  await temp(async (dir) => {
    const path = join(dir, "preferences.json");
    await writeFile(path, "broken");
    const repository = createTaskPreferenceRepository({
      store: new NodeAtomicJsonStore({
        filePath: path,
        defaultValue: DEFAULT_TASK_PREFERENCES,
        schema: preferenceSchema(clock),
        clock,
      }),
      clock,
    });
    assert.deepEqual((await repository.read()).tasks, {});
    assert.equal(
      (await readdir(dir)).some((name) =>
        name.startsWith("preferences.json.corrupt."),
      ),
      true,
    );
  });
});

test("run repository appends, compacts and recovers running records", async () => {
  await temp(async (dir) => {
    const path = join(dir, "runs.json");
    const repository = createTaskRunRepository({
      store: new NodeAtomicJsonStore({
        filePath: path,
        defaultValue: DEFAULT_TASK_RUNS,
        schema: taskRunsSchema(),
        clock,
      }),
      clock,
      maxEntries: 2,
    });
    await repository.append(run({ runId: "run:1" }));
    await repository.append(
      run({
        runId: "run:2",
        status: "succeeded",
        finishedAt: "2026-08-07T00:00:00.000Z",
      }),
    );
    await repository.append(run({ runId: "run:3", status: "queued" }));
    assert.deepEqual(
      (await repository.list()).map((item) => item.runId),
      ["run:3", "run:2"],
    );
    const recovered = await repository.recoverRunning();
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0]?.status, "abandoned");
    assert.equal(
      (await repository.list({ limit: 1 }))[0]?.errorCode,
      "errors.tasks.abandoned",
    );
    await repository.rotate();
    assert.doesNotMatch(
      await readFile(path, "utf8"),
      /prompt|command|path|stack|content/,
    );
  });
});

test("restart recovery is durable and idempotent", async () => {
  await temp(async (dir) => {
    const path = join(dir, "runs.json");
    const createRepository = () =>
      createTaskRunRepository({
        store: new NodeAtomicJsonStore({
          filePath: path,
          defaultValue: DEFAULT_TASK_RUNS,
          schema: taskRunsSchema(),
          clock,
        }),
        clock,
      });

    const first = createRepository();
    await first.append(run({ runId: "crash-before-shutdown" }));

    // A fresh repository instance models a process restart. The previous
    // running record is converted to an explicit terminal state on startup.
    const restarted = createRepository();
    const recovered = await restarted.recoverRunning();
    assert.deepEqual(
      recovered.map((item) => ({ runId: item.runId, status: item.status })),
      [{ runId: "crash-before-shutdown", status: "abandoned" }],
    );
    assert.equal(
      (await restarted.list({ limit: 1 }))[0]?.errorCode,
      "errors.tasks.abandoned",
    );

    // Re-running recovery must not append another terminal transition.
    assert.deepEqual(await restarted.recoverRunning(), []);
  });
});
