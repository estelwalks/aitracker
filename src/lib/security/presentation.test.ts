import assert from "node:assert/strict";
import test from "node:test";

import { formatDuration, getSecurityStats } from "./presentation.ts";
import type { SecurityReport } from "./scanner.ts";

function report(
  verdict: SecurityReport["verdict"],
  durationMs: number,
): SecurityReport {
  return {
    scannedAt: "2026-08-04T00:00:00.000Z",
    targetName: "SKILL.md",
    filesScanned: 1,
    risks: [],
    verdict,
    riskScore: 0,
    durationMs,
    rulesVersion: "test",
  };
}

test("derives six-card security counts and duration from local history", () => {
  assert.deepEqual(getSecurityStats([]), {
    scanned: 0,
    safe: 0,
    suspicious: 0,
    dangerous: 0,
    averageDurationMs: 0,
  });
  assert.deepEqual(
    getSecurityStats([
      report("安全", 100),
      report("可疑", 200),
      report("危险", 900),
    ]),
    {
      scanned: 3,
      safe: 1,
      suspicious: 1,
      dangerous: 1,
      averageDurationMs: 400,
    },
  );
  assert.equal(formatDuration(400), "400 ms");
  assert.equal(formatDuration(1200), "1.2 s");
});
