import assert from "node:assert/strict";
import test from "node:test";
import { JOB_EXECUTOR_KEYS } from "../../definitions/contracts.ts";
import { createExecutorRegistry } from "./index.ts";
import type { UsageApplication } from "../../../usage/index.ts";
import type { TaskExecutionContext } from "../scheduler.ts";

function context(): TaskExecutionContext {
  return {
    taskId: "usage.refresh" as TaskExecutionContext["taskId"],
    runId: "run-test" as TaskExecutionContext["runId"],
    attempt: 1,
    signal: new AbortController().signal,
    correlationId: "correlation-test" as TaskExecutionContext["correlationId"],
  };
}

function usageApplication(): UsageApplication {
  return {
    contract: { module: "usage", schemaVersion: 1 },
    getUsageSnapshot: async () => ({ ok: true, value: { state: "empty" } }),
    refreshUsage: async () => ({
      ok: true,
      value: {
        state: "fresh",
        committed: true,
        retainedPreviousSnapshot: false,
        snapshot: {
          generatedAt: "2026-01-01T00:00:00.000Z",
          mode: "empty",
          sources: [],
          events: 7,
          totals: {
            events: 7,
            inputTokens: 0,
            cachedInputTokens: 0,
            cacheCreationInputTokens: 0,
            outputTokens: 0,
            reasoningOutputTokens: 0,
            totalTokens: 0,
          },
          bySource: [],
          byModel: [],
          byProject: [],
          daily: [],
          details: [],
          recent: [],
        },
      },
    }),
  } as UsageApplication;
}

test("registry binds every catalog key with a static function", () => {
  const registry = createExecutorRegistry({ usage: usageApplication() });
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

test("usage executor delegates to the application use case", async () => {
  let calls = 0;
  const app = usageApplication();
  const usage = {
    ...app,
    refreshUsage: async (
      request?: Parameters<UsageApplication["refreshUsage"]>[0],
    ) => {
      calls += 1;
      return app.refreshUsage(request);
    },
  } satisfies UsageApplication;
  const result = await createExecutorRegistry({ usage }).executors[
    "refresh-usage-v1"
  ](context());
  assert.equal(calls, 1);
  assert.deepEqual(result, { summary: { scanned: 7, diagnosticCount: 0 } });
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
