import assert from "node:assert/strict";
import test from "node:test";
import { buildInsightSnapshot } from "./domain.ts";

const clock = { now: () => new Date("2026-08-07T00:00:00.000Z") };

test("empty input is deterministic and unknown", () => {
  const snapshot = buildInsightSnapshot({}, { clock });
  assert.deepEqual(snapshot.insights, []);
  assert.equal(snapshot.freshness, "unknown");
});

test("aggregates security and failed jobs with stable severity ordering", () => {
  const snapshot = buildInsightSnapshot(
    {
      security: {
        observedAt: "2026-08-06T23:00:00.000Z",
        findings: [
          { ref: "finding-2", severity: "high" },
          { ref: "finding-1", severity: "low" },
        ],
      },
      jobs: {
        observedAt: "2026-08-06T23:00:00.000Z",
        runs: [{ ref: "run-1", taskId: "usage.refresh", status: "failed" }],
      },
    },
    { clock },
  );
  assert.deepEqual(
    snapshot.insights.map((item) => item.severity),
    ["high", "medium", "low"],
  );
  assert.ok(snapshot.insights.every((item) => item.evidence.length > 0));
  assert.equal(snapshot.freshness, "fresh");
});

test("stale policy and incomplete pricing are explicit, without a precise amount", () => {
  const snapshot = buildInsightSnapshot(
    {
      usage: {
        observedAt: "2026-08-01T00:00:00.000Z",
        events: 2,
        totalTokens: 100,
        cost: { unknownEvents: 2, knownUsd: 999, complete: false },
      },
    },
    { clock, stalePolicy: { maxAgeMs: 60_000 } },
  );
  const uncertain = snapshot.insights.find(
    (item) => item.id === "usage.cost-uncertain",
  );
  assert.equal(snapshot.freshness, "stale");
  assert.equal(uncertain?.uncertainty, "high");
  assert.equal(JSON.stringify(uncertain).includes("999"), false);
});

test("evidence never exposes paths, commands, prompts or raw error text", () => {
  const snapshot = buildInsightSnapshot(
    {
      jobs: {
        observedAt: "2026-08-07T00:00:00.000Z",
        runs: [
          {
            ref: "/Users/alice/.config/token=secret",
            taskId: "x",
            status: "failed",
            errorCode: "errors.tasks.executionFailed",
          },
        ],
      },
      security: {
        observedAt: "2026-08-07T00:00:00.000Z",
        findings: [{ ref: "rm -rf /tmp/private", severity: "high" }],
      },
    },
    { clock },
  );
  const text = JSON.stringify(snapshot);
  assert.doesNotMatch(text, /Users|token=|rm -rf|private/);
  assert.match(text, /opaque-/);
});

test("duplicate finding refs are deduplicated", () => {
  const snapshot = buildInsightSnapshot(
    {
      security: {
        observedAt: "2026-08-07T00:00:00.000Z",
        findings: [
          { ref: "same", severity: "medium" },
          { ref: "same", severity: "medium" },
        ],
      },
    },
    { clock },
  );
  assert.equal(snapshot.insights.length, 1);
});
