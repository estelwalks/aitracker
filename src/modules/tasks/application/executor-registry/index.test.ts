import assert from "node:assert/strict";
import test from "node:test";
import { JOB_EXECUTOR_KEYS } from "../../definitions/contracts.ts";
import { createExecutorRegistry } from "./index.ts";
import type { RefreshUsagePort } from "./index.ts";
import type { TaskExecutionContext } from "../scheduler.ts";

function context(taskId = "usage.refresh"): TaskExecutionContext {
  return {
    taskId: taskId as TaskExecutionContext["taskId"],
    runId: "run-test" as TaskExecutionContext["runId"],
    attempt: 1,
    signal: new AbortController().signal,
    correlationId: "correlation-test" as TaskExecutionContext["correlationId"],
  };
}

function usagePort(): RefreshUsagePort {
  return {
    refresh: async () => undefined,
  };
}

test("registry binds every catalog key with a static function", () => {
  const registry = createExecutorRegistry({ usage: usagePort() });
  assert.deepEqual(
    Object.keys(registry.executors).sort(),
    [...JOB_EXECUTOR_KEYS].sort(),
  );
  for (const key of JOB_EXECUTOR_KEYS)
    assert.equal(typeof registry.resolve(key), "function");
});

test("unknown executor keys fail with a stable, non-sensitive error", () => {
  const registry = createExecutorRegistry();
  assert.throws(
    () => registry.resolve("../../etc/passwd"),
    (error: unknown) =>
      error instanceof Error &&
      error.name === "ControlledExecutorError" &&
      error.message === "errors.tasks.executor-unknown" &&
      !error.message.includes("passwd"),
  );
});

test("usage executor delegates to the snapshot refresh port", async () => {
  let calls = 0;
  const usage: RefreshUsagePort = {
    refresh: async () => {
      calls += 1;
    },
  };
  const result = await createExecutorRegistry({ usage }).executors[
    "refresh-usage-v1"
  ](context());
  assert.equal(calls, 1);
  assert.deepEqual(result, {});
});

test("a cancelled usage executor propagates the abort", async () => {
  const controller = new AbortController();
  controller.abort();
  const usage: RefreshUsagePort = {
    refresh: async ({ signal }) => {
      if (signal?.aborted) throw new Error("errors.tasks.cancelled");
    },
  };
  await assert.rejects(
    () =>
      createExecutorRegistry({ usage }).executors["refresh-usage-v1"]({
        ...context(),
        signal: controller.signal,
      }),
    /errors\.tasks\.cancelled/,
  );
});

test("unconfigured adapters return controlled availability errors", async () => {
  const registry = createExecutorRegistry();
  await assert.rejects(
    () => registry.executors["refresh-skills-v1"](context()),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "errors.tasks.executor-unavailable",
  );
});

test("retention executor delegates to the injected application port", async () => {
  let calls = 0;
  const registry = createExecutorRegistry({
    retention: {
      async apply() {
        calls += 1;
      },
    },
  });
  await registry.executors["apply-retention-v1"](context());
  assert.equal(calls, 1);
});

test("report tasks independently invoke daily, weekly and monthly-period generation", async () => {
  const calls: Array<{
    definitionId: string;
    trigger: string;
    period?: unknown;
  }> = [];
  const app = {
    definitions: [
      { definitionId: "reports.daily", kind: "daily", enabled: true },
      { definitionId: "reports.weekly", kind: "weekly", enabled: true },
    ],
    generate: async (input: {
      definitionId: string;
      trigger: string;
      period?: unknown;
    }) => {
      calls.push(input);
      return { ok: true, value: {} };
    },
  } as never;
  const registry = createExecutorRegistry({
    reports: app,
  });
  await registry.executors["generate-report-v1"](
    context("reports.generate.daily"),
  );
  await registry.executors["generate-report-v1"](
    context("reports.generate.weekly"),
  );
  await registry.executors["generate-report-v1"](
    context("reports.generate.monthly"),
  );
  assert.deepEqual(calls.slice(0, 2), [
    { definitionId: "reports.daily", trigger: "schedule" },
    { definitionId: "reports.weekly", trigger: "schedule" },
  ]);
  assert.equal(calls[2]?.definitionId, "reports.weekly");
  assert.equal(calls[2]?.trigger, "schedule");
  assert.match(
    JSON.stringify(calls[2]?.period),
    /"granularity":"month","key":"\d{4}-\d{2}"/,
  );
});
