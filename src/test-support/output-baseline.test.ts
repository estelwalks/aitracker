import assert from "node:assert/strict";
import test from "node:test";
import {
  BASELINE_VOLATILE_VALUE,
  marketListFixture,
  normalizeBaselineOutput,
  securityReportFixture,
  sessionSummaryFixture,
  skillSnapshotFixture,
  usageSnapshotFixture,
} from "./output-baseline.ts";

const fixtures = [
  usageSnapshotFixture,
  skillSnapshotFixture,
  sessionSummaryFixture,
  securityReportFixture,
  marketListFixture,
];

test("P0-01: fixture outputs contain no sensitive local data", () => {
  const serialized = JSON.stringify(fixtures);
  assert.doesNotMatch(serialized, /"(?:\/|[A-Za-z]:\\\\)/);
  assert.doesNotMatch(
    serialized,
    /\b(?:sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{12,}|AKIA[0-9A-Z]{16})\b/,
  );
  assert.doesNotMatch(serialized, /"(?:resumeCommand|command)":"[^"]+/);
  assert.doesNotMatch(serialized, /"(?:content|prompt|response)"\s*:/);
});

test("P0-01: normalizer changes only explicit volatile fields", () => {
  const actual = normalizeBaselineOutput({
    generatedAt: "later",
    runId: "random",
    fetchedAt: "later",
    scannedAt: "later",
    totalTokens: 7,
    session: { title: "business value", durationMs: 4 },
  });
  assert.deepEqual(actual, {
    generatedAt: BASELINE_VOLATILE_VALUE,
    runId: BASELINE_VOLATILE_VALUE,
    fetchedAt: BASELINE_VOLATILE_VALUE,
    scannedAt: BASELINE_VOLATILE_VALUE,
    totalTokens: 7,
    session: { title: "business value", durationMs: 4 },
  });
});
