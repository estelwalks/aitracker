import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateScanTask,
  aggregateScanTasks,
  countScanTasks,
  dedupeHistoryByContentHash,
  detectedRiskCount,
  EMPTY_SECURITY_PROGRESS,
  EMPTY_SECURITY_TOTALS,
  clampPercent,
  effectiveSecurityScanMode,
  hitDimensionsOf,
  historyForCurrentSkills,
  latestHistory,
  relativeTimeParts,
  reportNeedsLocaleRefresh,
  resolveNextScheduledScanAt,
  securityReportEvidenceState,
  securityHistoryEntryIsSafe,
  severityCounts,
  skippedReasonCode,
  summarizeReports,
  unsafeEntries,
  unsafeScanCount,
  unsafeVerdictTone,
  unresolvedScanCount,
  type SecurityHistoryView,
  type SecurityReportView,
} from "./security-view.ts";

test("enabled schedules project the next run while the runtime cursor loads", () => {
  const base = new Date(2026, 7, 27, 9, 0, 0, 0);
  const schedule = {
    enabled: true,
    cycle: "daily",
    time: "10:00",
    scope: "all",
    agents: [],
    dir: null,
    notify: false,
  } as const;

  assert.equal(
    resolveNextScheduledScanAt(schedule, null, base),
    new Date(2026, 7, 27, 10, 0, 0, 0).toISOString(),
  );
  assert.equal(
    resolveNextScheduledScanAt(schedule, {
      lastRun: null,
      nextRunAt: "2026-08-28T02:30:00.000Z",
      pending: false,
    }),
    "2026-08-28T02:30:00.000Z",
  );
  assert.equal(
    resolveNextScheduledScanAt({ ...schedule, enabled: false }, null, base),
    null,
  );
});

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
      skillRef: "skill:two",
      status: "failed",
      report: undefined,
    }),
  ]);
  assert.deepEqual(totals, {
    total: 2,
    safe: 1,
    warn: 0,
    danger: 0,
    unknown: 0,
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

test("only blocking static branches or unreadable files prevent a safe result", () => {
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
              path: "unreadable.txt",
              reasonCode: "unavailable",
              reason: "file unavailable",
            },
          ],
        }),
      }),
    ),
    false,
  );
  assert.equal(
    securityHistoryEntryIsSafe(
      historyEntry({
        report: report({
          branches: [
            { name: "static", status: "complete" },
            {
              name: "multiFileAnalysis",
              status: "failed",
              detail: "retry exhausted",
            },
          ],
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
    true,
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

test("AI-assisted scan mode requires both a model and the feature toggle", () => {
  assert.equal(effectiveSecurityScanMode("full", true, true), "full");
  assert.equal(effectiveSecurityScanMode("full", true, false), "quick");
  assert.equal(effectiveSecurityScanMode("full", false, true), "quick");
  assert.equal(effectiveSecurityScanMode("quick", true, true), "full");
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

test("historical totals stay global after a single-skill rescan", () => {
  const history = [
    historyEntry({
      id: "history:skill-one",
      skillName: "skill-one",
      report: report({ contentHash: "h1" }),
    }),
    historyEntry({
      id: "history:skill-two",
      skillRef: "skill:two",
      skillName: "skill-two",
      report: report({ contentHash: "h2", verdict: "block" }),
    }),
    historyEntry({
      id: "history:skill-three",
      skillRef: "skill:three",
      skillName: "skill-three",
      report: report({ contentHash: "h3" }),
    }),
    historyEntry({
      id: "history:skill-one-rescan",
      scanId: "scan:single",
      finishedAt: "2026-08-11T00:00:01.000Z",
      report: report({ contentHash: "h1" }),
    }),
  ];

  const latestScan = history.filter((entry) => entry.scanId === "scan:single");
  const latestTotals = summarizeReports(latestScan);
  const historicalTotals = summarizeReports(history);

  assert.equal(latestTotals.total, 1);
  assert.equal(historicalTotals.total, 3);
  assert.equal(historicalTotals.safe, 2);
  assert.equal(detectedRiskCount(historicalTotals), 1);
});

test("a safe rescan replaces an older unsafe verdict without shrinking history", () => {
  const totals = summarizeReports([
    historyEntry({
      skillName: "fixed-skill",
      report: report({ contentHash: "old-content", verdict: "block" }),
    }),
    historyEntry({
      id: "history:other",
      skillRef: "skill:other",
      skillName: "other",
      report: report({ contentHash: "other-content" }),
    }),
    historyEntry({
      id: "history:fixed-rescan",
      scanId: "scan:single",
      finishedAt: "2026-08-11T00:00:01.000Z",
      report: report({ contentHash: "new-content", verdict: "allow" }),
    }),
  ]);

  assert.equal(totals.total, 2);
  assert.equal(totals.safe, 2);
  assert.equal(detectedRiskCount(totals), 0);
});

test("dedupe keeps failed entries without a content hash", () => {
  const deduped = dedupeHistoryByContentHash([
    historyEntry({ report: report({ contentHash: "h1" }) }),
    historyEntry({
      id: "history:failed",
      skillRef: "skill:failed",
      status: "failed",
      report: undefined,
    }),
  ]);
  assert.equal(deduped.length, 2);
});

test("unsafeEntries includes findings even when scanner policy allows use", () => {
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
  const allowedFinding = historyEntry({
    id: "history:allowed-finding",
    report: report({
      verdict: "allow",
      findings: [
        {
          id: "finding:low",
          kind: "data_exfiltration",
          severity: "low",
          source: "static",
          kindDisplay: "数据泄露",
          severityDisplay: "低危",
          ruleName: "HTTP request",
          message: "HTTP request",
          remediation: "Review target",
          path: "scripts/exfil.py",
          line: 2,
        },
      ],
    }),
  });
  const partial = historyEntry({
    id: "history:partial",
    status: "partial",
    report: report({ status: "partial", verdict: "allow" }),
  });
  assert.deepEqual(
    unsafeEntries([
      safe,
      block,
      warn,
      allowedFinding,
      unknown,
      failed,
      partial,
    ]).map((entry) => entry.id),
    ["history:block", "history:warn", "history:allowed-finding"],
  );
  assert.deepEqual(unsafeEntries([safe]), []);
  assert.equal(securityHistoryEntryIsSafe(allowedFinding), false);
  assert.deepEqual(summarizeReports([allowedFinding]), {
    total: 1,
    safe: 0,
    warn: 1,
    danger: 0,
    unknown: 0,
    failed: 0,
    skipped: 0,
    findings: 1,
    files: 2,
  });
});

test("detected risks stay separate from incomplete and failed scans", () => {
  const totals = {
    ...EMPTY_SECURITY_TOTALS,
    warn: 1,
    danger: 2,
    unknown: 3,
    failed: 1,
  };
  assert.equal(detectedRiskCount(totals), 3);
  assert.equal(unresolvedScanCount(totals), 4);
  assert.equal(unsafeScanCount(totals), 7);
});

test("a partial unknown 100-point report is incomplete, not unsafe or clean", () => {
  const incomplete = historyEntry({
    status: "partial",
    report: report({
      status: "partial",
      verdict: "unknown",
      riskScore: 100,
      findings: [],
    }),
  });
  assert.equal(securityReportEvidenceState(incomplete), "incomplete");
  assert.deepEqual(unsafeEntries([incomplete]), []);

  const missingDetails = historyEntry({
    report: report({ verdict: "warn", findings: [] }),
  });
  assert.equal(
    securityReportEvidenceState(missingDetails),
    "risk-details-unavailable",
  );
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

test("unchanged automatic scans become history tasks without replacing evidence", () => {
  const previous = historyEntry({
    id: "history:previous",
    finishedAt: "2026-08-27T08:00:00.000Z",
    report: report(),
  });
  const unchanged = historyEntry({
    id: "history:unchanged",
    scanId: "scan:automatic",
    trigger: "automatic",
    status: "skipped",
    report: undefined,
    errorCode: "security.scan.unchanged",
    startedAt: "2026-08-27T08:30:00.000Z",
    finishedAt: "2026-08-27T08:30:01.000Z",
  });
  const task = aggregateScanTask([
    unchanged,
    { ...unchanged, id: "history:unchanged-two", skillRef: "skill:two" },
  ]);

  assert.equal(task.unchanged, true);
  assert.equal(task.status, "complete");
  assert.equal(task.totals.total, 2);
  assert.equal(task.totals.skipped, 2);
  assert.equal(latestHistory([previous, unchanged])?.id, previous.id);
  assert.equal(summarizeReports([previous, unchanged]).safe, 1);
});

test("mixed automatic scans treat reused evidence as neutral, not unsafe", () => {
  const scanned = historyEntry({
    id: "history:scanned",
    scanId: "scan:mixed",
    trigger: "automatic",
    report: report(),
  });
  const reused = historyEntry({
    id: "history:reused",
    scanId: "scan:mixed",
    skillRef: "skill:reused",
    trigger: "automatic",
    status: "skipped",
    report: undefined,
    errorCode: "security.scan.unchanged",
  });
  const task = aggregateScanTask([scanned, reused]);

  assert.equal(task.unchanged, false);
  assert.equal(task.safe, true);
  assert.equal(task.status, "complete");
  assert.equal(task.totals.total, 2);
  assert.equal(task.totals.safe, 1);
  assert.equal(task.totals.skipped, 1);
  assert.equal(unresolvedScanCount(task.totals), 0);
});

test("partial entries without findings remain unresolved but not unsafe", () => {
  const partial = historyEntry({
    id: "history:partial-review",
    status: "partial",
    report: report({ status: "partial", verdict: "allow", findings: [] }),
  });
  const task = aggregateScanTask([partial]);

  assert.equal(task.findings.length, 0);
  assert.equal(task.unsafeEntries.length, 0);
  assert.equal(unresolvedScanCount(task.totals), 1);
});

test("historyForCurrentSkills removes deleted assets from current posture", () => {
  const present = historyEntry({ skillRef: "skill:present" });
  const deleted = historyEntry({
    id: "history:deleted",
    skillRef: "skill:deleted",
    skillName: "deleted",
    status: "failed",
  });

  assert.deepEqual(
    historyForCurrentSkills(
      [present, deleted],
      [
        {
          skillRef: "skill:present",
          name: "present",
          agents: ["AiPy"],
          modifiedAt: "2026-08-10T00:00:00.000Z",
          source: "discovered",
        },
      ],
    ).map((entry) => entry.id),
    [present.id],
  );
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
    skillRef: "skill:risky",
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

test("aggregateScanTask does not fabricate a risk for a failed no-report entry", () => {
  const task = aggregateScanTask([
    historyEntry({
      id: "history:failed-entry",
      status: "failed",
      errorCode: "errors.security.scanFailed",
      report: undefined,
    }),
  ]);
  assert.equal(task.status, "failed");
  assert.equal(task.findings.length, 0);
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
