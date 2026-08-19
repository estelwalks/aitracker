import assert from "node:assert/strict";
import test from "node:test";

import { usageSnapshotFixture } from "../../../test-support/output-baseline.ts";
import type { UsageSnapshotDto } from "../contracts.ts";
import { createUsageCollector } from "./usage-collector.server.ts";
import { toPublicUsageSnapshot } from "./usage-adapter.server.ts";

function repository(initial?: UsageSnapshotDto) {
  let value = initial;
  return {
    load: async () => value,
    save: async (next: UsageSnapshotDto) => {
      value = next;
    },
    get value() {
      return value;
    },
  };
}

test("usage adapter preserves aggregates while removing paths and commands", () => {
  const snapshot = toPublicUsageSnapshot({
    ...usageSnapshotFixture,
    sources: [
      {
        ...usageSnapshotFixture.sources[0]!,
        paths: ["/Users/private/.codex"],
        diagnostics: [
          {
            source: "codex",
            code: "read-failed",
            path: "/Users/private/log.jsonl",
            count: 1,
            message: "safe",
          },
        ],
      },
    ],
    details: [
      {
        ...usageSnapshotFixture.details[0]!,
        context: {
          commands: [
            {
              kind: "exec_command",
              executable: "cat",
              safeSignature: "cat file",
              duration: "under-1s",
              outputSize: "empty",
              exitStatus: "success",
              calls: 1,
            },
          ],
        },
      },
    ],
  });
  assert.equal(
    snapshot.totals.totalTokens,
    usageSnapshotFixture.totals.totalTokens,
  );
  assert.deepEqual(snapshot.sources[0]?.paths, undefined);
  assert.deepEqual(snapshot.sources[0]?.diagnostics?.[0]?.path, undefined);
  assert.deepEqual(snapshot.details[0]?.context?.commands, undefined);
});

test("budget exhaustion retains the last persisted snapshot", async () => {
  const previous = { ...usageSnapshotFixture, generatedAt: "previous" };
  const store = repository(previous);
  const collector = createUsageCollector({
    repository: store,
    scanner: {
      scan: () => new Promise(() => undefined),
    },
  });
  const result = await collector.collect({ budget: { maxDurationMs: 5 } });
  assert.equal(result.budgetExhausted, true);
  assert.equal(result.retainedPreviousSnapshot, true);
  assert.equal(result.snapshot.generatedAt, "previous");
});

test("scanner failure retains the last persisted snapshot", async () => {
  const previous = { ...usageSnapshotFixture, generatedAt: "previous" };
  const store = repository(previous);
  const collector = createUsageCollector({
    repository: store,
    scanner: {
      scan: async () => {
        throw new Error("private scanner detail");
      },
    },
  });
  const result = await collector.collect();
  assert.equal(result.cancelled, false);
  assert.equal(result.retainedPreviousSnapshot, true);
  assert.equal(result.snapshot.generatedAt, "previous");
});

test("degraded scanner output does not replace the last successful snapshot", async () => {
  const previous = { ...usageSnapshotFixture, generatedAt: "previous" };
  const store = repository(previous);
  const collector = createUsageCollector({
    repository: store,
    scanner: {
      scan: async () => ({
        ...usageSnapshotFixture,
        generatedAt: "failed-current",
        sources: [
          {
            ...usageSnapshotFixture.sources[0]!,
            available: false,
            diagnostics: [
              {
                source: "codex",
                code: "read-failed",
                count: 1,
                message: "safe",
              },
            ],
          },
        ],
      }),
    },
  });
  const result = await collector.collect();
  assert.equal(result.snapshot.generatedAt, "previous");
  assert.equal(result.health.status, "degraded");
  assert.equal(result.retainedPreviousSnapshot, true);
});

test("abort signal returns a safe empty result when no snapshot exists", async () => {
  const controller = new AbortController();
  controller.abort();
  const collector = createUsageCollector({
    scanner: { scan: async () => usageSnapshotFixture },
  });
  const result = await collector.collect({ signal: controller.signal });
  assert.equal(result.cancelled, true);
  assert.equal(result.snapshot.mode, "empty");
});
