import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createCorrelationId,
  createRunId,
  createTaskId,
} from "../../shared/ids.ts";
import { createInMemoryMetrics } from "./metrics.ts";
import { NodeCorrelationContext } from "./infrastructure/node-correlation-context.ts";
import { NodeJsonlLogger } from "./infrastructure/node-jsonl-logger.ts";
import { redactObservation } from "./redaction.ts";

async function withTempDirectory<T>(
  run: (directory: string) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "trusttools-observability-"));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("Node correlation context propagates task identity across an async operation", async () => {
  const context = new NodeCorrelationContext();
  const value = {
    correlationId: createCorrelationId("corr-01"),
    taskId: createTaskId("usage.refresh"),
    runId: createRunId("run-01"),
    module: "usage",
  };
  await context.run(value, async () => {
    await Promise.resolve();
    assert.deepEqual(context.current(), value);
  });
  assert.equal(context.current(), undefined);
});

test("redaction removes raw fields and redacts paths, credentials and commands", () => {
  const result = redactObservation(
    {
      level: "error",
      event: "usage.refresh.failed",
      module: "usage",
      outcome: "failure",
      errorCode: "errors.generic",
      attributes: {
        command: "node secret-script.mjs",
        prompt: "private prompt",
        localPath: "/Users/example/private.json",
        credentialHint: "Bearer abcdefghijklmnop",
        shellHint: "npm run secret-task",
        attempt: 2,
      },
    },
    "2026-08-06T00:00:00.000Z",
  );
  const json = JSON.stringify(result);
  assert.deepEqual(result.attributes, {
    localPath: "[REDACTED]",
    credentialHint: "[REDACTED]",
    shellHint: "[REDACTED]",
    attempt: 2,
  });
  assert.equal(json.includes("secret-script"), false);
  assert.equal(json.includes("private prompt"), false);
  assert.equal(json.includes("/Users/example"), false);
  assert.equal(json.includes("Bearer abcdefghijklmnop"), false);
});

test("JSONL logger rotates bounded archives and writes the required safe fields", async () => {
  await withTempDirectory(async (directory) => {
    const context = new NodeCorrelationContext();
    const logger = new NodeJsonlLogger({
      dataRoot: directory,
      clock: { now: () => new Date("2026-08-06T00:00:00.000Z") },
      correlationContext: context,
      maxFileBytes: 250,
      maxRotatedFiles: 1,
    });
    const operation = () =>
      logger.write({
        level: "info",
        event: "usage.refresh.completed",
        module: "usage",
        outcome: "success",
        durationMs: 12,
      });
    await context.run(
      {
        correlationId: createCorrelationId("corr-02"),
        taskId: createTaskId("usage.refresh"),
        runId: createRunId("run-02"),
      },
      async () => {
        await operation();
        await operation();
        await operation();
      },
    );
    const files = await readdir(directory);
    assert.deepEqual(files.sort(), [
      "observability.jsonl",
      "observability.jsonl.1",
    ]);
    const current = JSON.parse(
      await readFile(join(directory, "observability.jsonl"), "utf8"),
    );
    assert.deepEqual(Object.keys(current).sort(), [
      "correlationId",
      "durationMs",
      "event",
      "level",
      "module",
      "outcome",
      "runId",
      "taskId",
      "timestamp",
    ]);
    assert.equal(current.correlationId, "corr-02");
  });
});

test("in-memory metrics aggregate counters and duration distributions", () => {
  const metrics = createInMemoryMetrics();
  metrics.increment("usage.refresh.count");
  metrics.increment("usage.refresh.count", 2);
  metrics.observeDuration("usage.refresh.duration", 5);
  metrics.observeDuration("usage.refresh.duration", 9);
  assert.deepEqual(metrics.snapshot(), [
    { name: "usage.refresh.count", kind: "counter", count: 2, sum: 3 },
    {
      name: "usage.refresh.duration",
      kind: "duration",
      count: 2,
      sum: 14,
      min: 5,
      max: 9,
    },
  ]);
});
