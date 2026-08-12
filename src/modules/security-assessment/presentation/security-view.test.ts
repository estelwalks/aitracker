import assert from "node:assert/strict";
import test from "node:test";

import {
  EMPTY_SECURITY_PROGRESS,
  clampPercent,
  latestHistory,
  reportNeedsLocaleRefresh,
  securityHistoryEntryIsSafe,
  skippedReasonCode,
  summarizeReports,
  type SecurityHistoryView,
  type SecurityReportView,
} from "./security-view.ts";

function report(
  overrides: Partial<SecurityReportView> = {},
): SecurityReportView {
  return {
    status: "complete",
    mode: "quick",
    verdict: "allow",
    riskScore: 100,
    rulesVersion: "1",
    engineVersion: "0.2.0",
    locale: "zh-CN",
    scannedFiles: 2,
    threatLevel: "none",
    threatLevelDisplay: "none",
    summary: "ok",
    findings: [],
    branches: [{ name: "static", status: "complete" }],
    skippedFiles: [],
    ...overrides,
  };
}

test("summarizeReports preserves successes when another Skill fails", () => {
  const totals = summarizeReports([
    historyEntry({ report: report() }),
    historyEntry({
      id: "history:two",
      status: "failed",
      report: undefined,
    }),
  ]);
  assert.deepEqual(totals, {
    total: 2,
    safe: 1,
    warn: 0,
    danger: 0,
    unknown: 1,
    failed: 1,
    skipped: 0,
    findings: 0,
    files: 2,
  });
});

test("summarizeReports exposes real task failure and skip counters", () => {
  const totals = summarizeReports(
    [
      historyEntry({
        report: report({
          skippedFiles: [
            { path: "asset.bin", reasonCode: "binary", reason: "binary" },
          ],
        }),
      }),
    ],
    { ...EMPTY_SECURITY_PROGRESS, discovered: 3, failed: 1, skipped: 2 },
  );
  assert.equal(totals.total, 3);
  assert.equal(totals.failed, 1);
  assert.equal(totals.skipped, 2);
});

test("locale mismatch is explicit and never translated in place", () => {
  assert.equal(reportNeedsLocaleRefresh(report(), "en-US"), true);
  assert.equal(reportNeedsLocaleRefresh(report(), "zh-CN"), false);
});

test("partial allow report is never counted as safe", () => {
  const entry = historyEntry({
    status: "partial",
    report: report({ status: "partial", verdict: "allow" }),
  });
  assert.equal(securityHistoryEntryIsSafe(entry), false);
  const totals = summarizeReports([entry]);
  assert.equal(totals.safe, 0);
  assert.equal(totals.unknown, 1);
});

test("allow report with a failed branch or skipped file is not safe", () => {
  assert.equal(
    securityHistoryEntryIsSafe(
      historyEntry({
        report: report({
          branches: [{ name: "static", status: "failed" }],
        }),
      }),
    ),
    false,
  );
  assert.equal(
    securityHistoryEntryIsSafe(
      historyEntry({
        report: report({
          skippedFiles: [
            {
              path: "asset.bin",
              reasonCode: "binary",
              reason: "binary file",
            },
          ],
        }),
      }),
    ),
    false,
  );
});

test("skipped reasons map to stable codes and unknown stays opaque", () => {
  assert.equal(
    skippedReasonCode({
      reasonCode: "symlink",
      reason: "symbolic link was not scanned",
    }),
    "symbolicLink",
  );
  assert.equal(
    skippedReasonCode({
      reasonCode: "scanner-skip",
      reason: "potentially sensitive raw detail",
    }),
    "scannerSkip",
  );
});

test("latestHistory sorts by persisted finish time", () => {
  const base: SecurityHistoryView = {
    id: "scan:old",
    scanId: "scan:old",
    skillRef: "skill:one",
    skillName: "one",
    mode: "quick",
    trigger: "manual",
    locale: "zh-CN",
    status: "complete",
    startedAt: "2026-08-10T00:00:00.000Z",
    finishedAt: "2026-08-10T00:00:01.000Z",
  };
  assert.equal(
    latestHistory([
      { ...base, id: "scan:new", finishedAt: "2026-08-11T00:00:01.000Z" },
      base,
    ])?.id,
    "scan:new",
  );
});

function historyEntry(
  overrides: Partial<SecurityHistoryView> = {},
): SecurityHistoryView {
  return {
    id: "history:one",
    scanId: "scan:one",
    skillRef: "skill:one",
    skillName: "one",
    mode: "quick",
    trigger: "manual",
    locale: "zh-CN",
    status: "complete",
    startedAt: "2026-08-10T00:00:00.000Z",
    finishedAt: "2026-08-10T00:00:01.000Z",
    ...overrides,
  };
}

test("clampPercent rejects fake or invalid percentages", () => {
  assert.equal(clampPercent(-4), 0);
  assert.equal(clampPercent(42), 42);
  assert.equal(clampPercent(120), 100);
  assert.equal(clampPercent(Number.NaN), 0);
});
