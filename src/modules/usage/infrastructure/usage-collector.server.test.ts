import assert from "node:assert/strict";
import test from "node:test";

import { buildLocalUsageSnapshot } from "../../../lib/local-usage/aggregate.ts";
import type {
  LocalUsageEvent,
  LocalUsageSourceSummary,
} from "../../../lib/local-usage/types.ts";
import { usageSnapshotFixture } from "../../../test-support/output-baseline.ts";
import { compactUsageSnapshot } from "../application/aggregate-projection.ts";
import { RETAINED_PREVIOUS_CODE } from "../application/retain-source-evidence.ts";
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

const tokenCounts = {
  inputTokens: 100,
  cachedInputTokens: 10,
  cacheCreationInputTokens: 0,
  outputTokens: 20,
  reasoningOutputTokens: 5,
  totalTokens: 135,
};

function retentionEvent(
  source: "pi" | "codex",
  timestamp: string,
): LocalUsageEvent {
  return {
    source,
    timestamp,
    model: `model-${source}`,
    project: `project-${source}`,
    sessionId: `session-${source}-1`,
    ...tokenCounts,
  };
}

function retentionRow(source: "pi" | "codex"): LocalUsageSourceSummary {
  return {
    source,
    available: true,
    filesConsidered: 1,
    filesRead: 1,
    filesReused: 0,
    filesParsed: 1,
    malformedLines: 0,
    events: 1,
  };
}

function lifelessRetentionRow(source: "pi" | "codex"): LocalUsageSourceSummary {
  return {
    source,
    available: false,
    detected: false,
    filesConsidered: 0,
    filesRead: 0,
    filesReused: 0,
    filesParsed: 0,
    malformedLines: 0,
    events: 0,
  };
}

test("a previously healthy source scanning empty keeps its last evidence", async () => {
  const previous = compactUsageSnapshot(
    buildLocalUsageSnapshot(
      [retentionEvent("pi", "2026-08-06T10:00:00.000Z")],
      [retentionRow("pi")],
      new Date("2026-09-01T00:00:00.000Z"),
    ),
  );
  const store = repository(previous);
  const collector = createUsageCollector({
    repository: store,
    scanner: {
      // pi is now lifeless (e.g. data-directory override rebased to a
      // non-existent layout) while codex keeps the snapshot healthy.
      scan: async () =>
        buildLocalUsageSnapshot(
          [retentionEvent("codex", "2026-08-07T10:00:00.000Z")],
          [retentionRow("codex"), lifelessRetentionRow("pi")],
          new Date("2026-09-02T00:00:00.000Z"),
        ),
    },
  });

  const result = await collector.collect();
  assert.equal(result.retainedPreviousSnapshot, false);
  assert.equal(result.health.status, "healthy");
  const pi = result.snapshot.sources.find((item) => item.source === "pi");
  assert.ok(pi, "pi row survives the empty scan");
  assert.equal(pi.events, 1);
  assert.equal(pi.filesRead, 1);
  assert.ok(
    pi.diagnostics?.some((item) => item.code === RETAINED_PREVIOUS_CODE),
    "kept evidence is marked with retained-previous",
  );
  assert.equal(result.snapshot.totals.events, 2, "pi + codex evidence totals");
  assert.ok(store.value, "collector must persist the merged snapshot");
  assert.ok(
    store.value.sources.some(
      (item) =>
        item.source === "pi" &&
        item.events === 1 &&
        item.diagnostics?.some(
          (diagnostic) => diagnostic.code === RETAINED_PREVIOUS_CODE,
        ),
    ),
    "the merged snapshot is what gets persisted",
  );
});

test("a source that scanned fresh data replaces its previous evidence", async () => {
  const previous = compactUsageSnapshot(
    buildLocalUsageSnapshot(
      [retentionEvent("pi", "2026-08-06T10:00:00.000Z")],
      [retentionRow("pi")],
      new Date("2026-09-01T00:00:00.000Z"),
    ),
  );
  const current = buildLocalUsageSnapshot(
    [retentionEvent("pi", "2026-08-08T10:00:00.000Z")],
    [retentionRow("pi")],
    new Date("2026-09-02T00:00:00.000Z"),
  );
  const store = repository(previous);
  const collector = createUsageCollector({
    repository: store,
    scanner: { scan: async () => current },
  });
  const result = await collector.collect();
  const pi = result.snapshot.sources.find((item) => item.source === "pi");
  assert.ok(pi);
  assert.equal(pi.events, 1);
  assert.ok(
    !pi.diagnostics?.some((item) => item.code === RETAINED_PREVIOUS_CODE),
  );
  assert.equal(result.snapshot.generatedAt, current.generatedAt);
});

test("lifeless sources without previous evidence stay zero", async () => {
  const previous = compactUsageSnapshot(
    buildLocalUsageSnapshot([], [], new Date("2026-09-01T00:00:00.000Z")),
  );
  const current = buildLocalUsageSnapshot(
    [retentionEvent("codex", "2026-08-07T10:00:00.000Z")],
    [retentionRow("codex"), lifelessRetentionRow("pi")],
    new Date("2026-09-02T00:00:00.000Z"),
  );
  const store = repository(previous);
  const collector = createUsageCollector({
    repository: store,
    scanner: { scan: async () => current },
  });
  const result = await collector.collect();
  const pi = result.snapshot.sources.find((item) => item.source === "pi");
  const codex = result.snapshot.sources.find((item) => item.source === "codex");
  assert.equal(pi?.events, 0, "pi never had evidence, nothing to retain");
  assert.ok(
    !pi?.diagnostics?.some((item) => item.code === RETAINED_PREVIOUS_CODE),
  );
  assert.equal(codex?.events, 1, "codex scanned fresh data");
  assert.equal(result.snapshot.generatedAt, current.generatedAt);
});
