import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateScanTask,
  aggregateScanTasks,
  countScanTasks,
  dedupeHistoryByContentHash,
  EMPTY_SECURITY_PROGRESS,
  clampPercent,
  hitDimensionsOf,
  latestHistory,
  relativeTimeParts,
  reportNeedsLocaleRefresh,
  securityHistoryEntryIsSafe,
  severityCounts,
  skippedReasonCode,
  summarizeReports,
  unsafeEntries,
  unsafeVerdictTone,
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

test("dedupeHistoryByContentHash collapses re-scans and install copies by content hash", () => {
  const entries = [
    historyEntry({
      skillRef: "skill:copy-a",
      skillName: "git-helper",
      report: report({ contentHash: "hash-abc", verdict: "allow" }),
    }),
    historyEntry({
      id: "history:rescan",
      scanId: "scan:two",
      skillRef: "skill:copy-a",
      skillName: "git-helper",
      finishedAt: "2026-08-11T00:00:01.000Z",
      report: report({ contentHash: "hash-abc", verdict: "allow" }),
    }),
    historyEntry({
      id: "history:copy-b",
      skillRef: "skill:copy-b",
      skillName: "git-helper",
      report: report({ contentHash: "hash-abc", verdict: "allow" }),
    }),
  ];
  const deduped = dedupeHistoryByContentHash(entries);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].skillRef, "skill:copy-a");
});

test("summarizeReports counts each unique skill once across repeated scans", () => {
  const totals = summarizeReports([
    historyEntry({ report: report({ contentHash: "h1" }) }),
    historyEntry({
      id: "history:again",
      scanId: "scan:two",
      finishedAt: "2026-08-11T00:00:01.000Z",
      report: report({ contentHash: "h1" }),
    }),
    historyEntry({
      id: "history:second-skill",
      skillRef: "skill:two",
      skillName: "two",
      report: report({ contentHash: "h2" }),
    }),
  ]);
  assert.equal(totals.total, 2);
  assert.equal(totals.safe, 2);
  assert.equal(totals.findings, 0);
});

test("dedupe keeps failed entries without a content hash", () => {
  const deduped = dedupeHistoryByContentHash([
    historyEntry({ report: report({ contentHash: "h1" }) }),
    historyEntry({ id: "history:failed", status: "failed", report: undefined }),
  ]);
  assert.equal(deduped.length, 2);
});

test("unsafeEntries keeps only entries that are not safe", () => {
  const block = historyEntry({
    id: "history:block",
    skillName: "blocker",
    report: report({ verdict: "block" }),
  });
  const warn = historyEntry({
    id: "history:warn",
    skillName: "warner",
    report: report({ verdict: "warn" }),
  });
  const unknown = historyEntry({
    id: "history:unknown",
    skillName: "unknown",
    report: report({ verdict: "unknown" }),
  });
  const failed = historyEntry({
    id: "history:failed-entry",
    status: "failed",
    report: undefined,
  });
  const safe = historyEntry({ id: "history:safe", report: report() });
  const partial = historyEntry({
    id: "history:partial",
    status: "partial",
    report: report({ status: "partial", verdict: "allow" }),
  });
  assert.deepEqual(
    unsafeEntries([safe, block, warn, unknown, failed, partial]).map(
      (entry) => entry.id,
    ),
    [
      "history:block",
      "history:warn",
      "history:unknown",
      "history:failed-entry",
      "history:partial",
    ],
  );
  assert.deepEqual(unsafeEntries([safe]), []);
});

test("unsafeVerdictTone maps block to danger and everything else to warn", () => {
  assert.equal(
    unsafeVerdictTone(historyEntry({ report: report({ verdict: "block" }) })),
    "danger",
  );
  assert.equal(
    unsafeVerdictTone(historyEntry({ report: report({ verdict: "warn" }) })),
    "warn",
  );
  assert.equal(
    unsafeVerdictTone(historyEntry({ report: report({ verdict: "unknown" }) })),
    "warn",
  );
  assert.equal(
    unsafeVerdictTone(historyEntry({ status: "failed", report: undefined })),
    "warn",
  );
});

test("hitDimensionsOf dedupes risk-dimension display names", () => {
  const entry = historyEntry({
    report: report({
      findings: [
        {
          id: "remote_execution",
          kind: "remote_execution",
          severity: "high",
          source: "static",
          kindDisplay: "代码执行",
          severityDisplay: "high",
          ruleName: "exec",
          message: "m",
          remediation: "r",
          path: "a.js",
        },
        {
          id: "secret_access",
          kind: "secret_access",
          severity: "high",
          source: "static",
          kindDisplay: "密钥访问",
          severityDisplay: "high",
          ruleName: "sec",
          message: "m",
          remediation: "r",
          path: "b.js",
        },
        {
          id: "remote_execution-2",
          kind: "remote_execution",
          severity: "medium",
          source: "static",
          kindDisplay: "代码执行",
          severityDisplay: "medium",
          ruleName: "exec",
          message: "m",
          remediation: "r",
          path: "c.js",
        },
      ],
    }),
  });
  assert.deepEqual(hitDimensionsOf(entry), ["代码执行", "密钥访问"]);
  assert.deepEqual(hitDimensionsOf(historyEntry()), []);
});

test("severityCounts tallies findings per severity", () => {
  const reportView = report({
    findings: [
      {
        id: "a",
        kind: "remote_execution",
        severity: "critical",
        source: "static",
        kindDisplay: "代码执行",
        severityDisplay: "critical",
        ruleName: "a",
        message: "m",
        remediation: "r",
        path: "a",
      },
      {
        id: "b",
        kind: "secret_access",
        severity: "high",
        source: "model",
        kindDisplay: "密钥访问",
        severityDisplay: "high",
        ruleName: "b",
        message: "m",
        remediation: "r",
        path: "b",
      },
      {
        id: "c",
        kind: "network_abuse",
        severity: "medium",
        source: "static",
        kindDisplay: "网络访问",
        severityDisplay: "medium",
        ruleName: "c",
        message: "m",
        remediation: "r",
        path: "c",
      },
      {
        id: "d",
        kind: "obfuscation",
        severity: "low",
        source: "static",
        kindDisplay: "代码混淆",
        severityDisplay: "low",
        ruleName: "d",
        message: "m",
        remediation: "r",
        path: "d",
      },
    ],
  });
  assert.deepEqual(severityCounts(reportView), {
    critical: 1,
    high: 1,
    medium: 1,
    low: 1,
  });
  assert.deepEqual(severityCounts(report()), {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  });
});

test("countScanTasks counts unique scanIds", () => {
  assert.equal(
    countScanTasks([
      historyEntry(),
      historyEntry({ id: "history:two", scanId: "scan:two" }),
      historyEntry({ id: "history:three", scanId: "scan:three" }),
    ]),
    3,
  );
  assert.equal(
    countScanTasks([historyEntry(), historyEntry({ id: "history:two" })]),
    1,
  );
  assert.equal(countScanTasks([]), 0);
});

test("aggregateScanTask builds a single-entry (single-skill) task", () => {
  const entry = historyEntry({
    report: report({
      verdict: "block",
      findings: [
        {
          id: "f1",
          kind: "remote_execution",
          severity: "high",
          source: "static",
          kindDisplay: "代码执行",
          severityDisplay: "high",
          ruleName: "r",
          message: "执行危险命令",
          remediation: "移除该命令",
          path: "a.js",
        },
      ],
    }),
  });
  const task = aggregateScanTask([entry]);
  assert.equal(task.scanId, "scan:one");
  assert.equal(task.scope, "single");
  assert.equal(task.status, "complete");
  assert.equal(task.safe, false);
  assert.equal(task.startedAt, entry.startedAt);
  assert.equal(task.finishedAt, entry.finishedAt);
  assert.equal(task.totals.total, 1);
  assert.equal(task.findings.length, 1);
  assert.equal(task.findings[0].tone, "danger");
  assert.equal(task.findings[0].issue, "执行危险命令");
  assert.equal(task.findings[0].advice, "移除该命令");
  assert.equal(task.findings[0].entryId, entry.id);
});

test("aggregateScanTask aggregates timestamps and expands unsafe findings", () => {
  const first = historyEntry({
    id: "history:first",
    scanId: "scan:multi",
    skillName: "safe-skill",
    startedAt: "2026-08-10T00:00:00.000Z",
    finishedAt: "2026-08-10T00:00:05.000Z",
    report: report({ contentHash: "h1" }),
  });
  const second = historyEntry({
    id: "history:second",
    scanId: "scan:multi",
    skillName: "risky-skill",
    startedAt: "2026-08-10T00:00:01.000Z",
    finishedAt: "2026-08-10T00:00:10.000Z",
    report: report({
      contentHash: "h2",
      verdict: "warn",
      findings: [
        {
          id: "f1",
          kind: "secret_access",
          severity: "medium",
          source: "static",
          kindDisplay: "密钥访问",
          severityDisplay: "medium",
          ruleName: "r",
          message: "读取凭证",
          remediation: "清理密钥",
          path: "a.js",
        },
      ],
    }),
  });
  const task = aggregateScanTask([first, second]);
  assert.equal(task.scope, "all");
  assert.equal(task.startedAt, "2026-08-10T00:00:00.000Z");
  assert.equal(task.finishedAt, "2026-08-10T00:00:10.000Z");
  assert.equal(task.safe, false);
  assert.equal(task.totals.total, 2);
  assert.equal(task.findings.length, 1);
  assert.equal(task.findings[0].tone, "warn");
});

test("aggregateScanTask degrades a failed no-report entry to an entry-level finding", () => {
  const task = aggregateScanTask([
    historyEntry({
      id: "history:failed-entry",
      status: "failed",
      errorCode: "errors.security.scanFailed",
      report: undefined,
    }),
  ]);
  assert.equal(task.status, "failed");
  assert.equal(task.findings.length, 1);
  assert.equal(task.findings[0].severity, null);
  assert.equal(task.findings[0].kindDisplay, "");
  assert.equal(task.findings[0].issue, "errors.security.scanFailed");
  assert.equal(task.findings[0].advice, "");
});

test("aggregateScanTask of an all-safe scan yields no findings", () => {
  const task = aggregateScanTask([
    historyEntry({ report: report({ contentHash: "h1" }) }),
    historyEntry({
      id: "history:two",
      skillRef: "skill:two",
      skillName: "two",
      scanId: "scan:two-entries",
      report: report({ contentHash: "h2" }),
    }),
  ]);
  assert.equal(task.safe, true);
  assert.equal(task.status, "complete");
  assert.equal(task.findings.length, 0);
});

test("aggregateScanTasks groups by scanId and sorts newest-first", () => {
  const old = historyEntry({
    id: "history:old",
    scanId: "scan:old",
    finishedAt: "2026-08-09T00:00:01.000Z",
  });
  const newGroup = historyEntry({
    id: "history:new-a",
    scanId: "scan:new",
    skillName: "a",
    finishedAt: "2026-08-11T00:00:01.000Z",
  });
  const newGroupB = historyEntry({
    id: "history:new-b",
    scanId: "scan:new",
    skillName: "b",
    finishedAt: "2026-08-11T00:00:02.000Z",
  });
  const tasks = aggregateScanTasks([old, newGroup, newGroupB]);
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].scanId, "scan:new");
  assert.equal(tasks[0].entries.length, 2);
  assert.equal(tasks[1].scanId, "scan:old");
  assert.equal(tasks[0].scope, "all");
  assert.equal(tasks[1].scope, "single");
});

test("relativeTimeParts clamps to sane relative units", () => {
  const base = Date.parse("2026-08-10T00:00:00.000Z");
  assert.deepEqual(
    relativeTimeParts(new Date(base).toISOString(), base + 30_000),
    {
      unit: "just",
      value: 0,
    },
  );
  assert.deepEqual(
    relativeTimeParts(new Date(base).toISOString(), base + 5 * 60_000),
    {
      unit: "minute",
      value: 5,
    },
  );
  assert.deepEqual(
    relativeTimeParts(new Date(base).toISOString(), base + 90 * 60_000),
    {
      unit: "hour",
      value: 1,
    },
  );
  assert.deepEqual(
    relativeTimeParts(new Date(base).toISOString(), base + 2 * 24 * 3_600_000),
    {
      unit: "day",
      value: 2,
    },
  );
  // Future timestamps clamp to "just" rather than negative units.
  assert.deepEqual(
    relativeTimeParts(new Date(base).toISOString(), base - 60_000),
    {
      unit: "just",
      value: 0,
    },
  );
});
