import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getCompositionRoot,
  resetCompositionRootForTests,
} from "./composition.server.ts";
import type { JobRun } from "../modules/tasks/application/task-storage.ts";

/**
 * End-to-end integration for the composition-wired scheduler. Uses the REAL
 * getCompositionRoot() (not injected fakes) against an isolated
 * TRUSTTOOLS_USAGE_HOME so it exercises AtomicJsonStore → repository →
 * scheduler with the same wiring production uses.
 *
 * Scope: these tests prove the *composition wiring* is live — that start()
 * drives recoverRunning() against the AtomicJsonStore-backed repository and
 * that persisted runs are durable. They deliberately avoid runNow(): the
 * scheduler fires executors with `void execute(...)` (scheduler.ts:179), whose
 * terminal-state append lands after runNow returns and survives stop(), so
 * driving it here would leak unhandled rejections across tests. The runNow →
 * executor → failed-state path is already covered exhaustively by the
 * injected-fake scheduler unit tests.
 */

async function isolatedRoot<T>(
  fn: (
    root: Awaited<ReturnType<typeof getCompositionRoot>>,
    dir: string,
  ) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "trusttools-composition-it-"));
  const savedHome = process.env.TRUSTTOOLS_USAGE_HOME;
  process.env.TRUSTTOOLS_USAGE_HOME = dir;
  try {
    const root = await getCompositionRoot();
    try {
      return await fn(root, dir);
    } finally {
      await root.scheduler.stop();
    }
  } finally {
    resetCompositionRootForTests();
    if (savedHome === undefined) delete process.env.TRUSTTOOLS_USAGE_HOME;
    else process.env.TRUSTTOOLS_USAGE_HOME = savedHome;
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

test("composition wires the scheduler so start() recovers interrupted runs via the AtomicJsonStore", async () => {
  await isolatedRoot(async ({ scheduler, runs }) => {
    // Seed a crash-mid-run record directly through the repository (synchronous
    // await — no fire-and-forget executor involved).
    const interrupted: JobRun = {
      runId: "run:interrupted-1",
      taskId: "usage.refresh",
      trigger: "schedule",
      status: "running",
      attempt: 1,
      correlationId: "corr-interrupted-1",
      startedAt: "2026-08-06T23:59:00.000Z",
    };
    await runs.append(interrupted);

    await scheduler.start();

    const listed = await runs.list({ taskId: "usage.refresh" });
    const recovered = listed.find(
      (candidate) => candidate.runId === interrupted.runId,
    );
    assert.ok(recovered, "interrupted run should still be present");
    assert.equal(recovered.status, "abandoned");
  });
});

test("appended runs persist to the on-disk JSON file through the wired AtomicJsonStore", async () => {
  await isolatedRoot(async ({ runs }, dir) => {
    const seed: JobRun = {
      runId: "run:seed-1",
      taskId: "usage.refresh",
      trigger: "manual",
      status: "succeeded",
      attempt: 1,
      correlationId: "corr-seed-1",
      finishedAt: "2026-08-07T00:00:00.000Z",
    };
    await runs.append(seed);

    // The AtomicJsonStore wraps the file as { schemaVersion, data }; reading
    // the raw file proves the commit is durable on the wired repository.
    const raw = await readFile(
      join(dir, ".trusttools", "tasks", "runs.v1.json"),
      "utf8",
    );
    const wrapped = JSON.parse(raw) as { data: { runs: JobRun[] } };
    assert.ok(
      wrapped.data.runs.some((candidate) => candidate.runId === seed.runId),
      "appended run should be present in the persisted runs file",
    );
  });
});

test("composition exposes a scheduler, preferences and runs bound to the resolved data root", async () => {
  await isolatedRoot(async (root, dir) => {
    assert.ok(root.scheduler, "scheduler must be wired");
    assert.ok(root.preferences, "preferences repository must be wired");
    assert.ok(root.runs, "runs repository must be wired");
    assert.equal(
      root.dataRoot,
      dir,
      "data root must follow TRUSTTOOLS_USAGE_HOME",
    );
    // getNextRunAt exercises the catalog binding without scheduling execution.
    const next = root.scheduler.getNextRunAt("usage.refresh" as never);
    assert.ok(next instanceof Date, "scheduler must resolve catalog schedules");
  });
});
