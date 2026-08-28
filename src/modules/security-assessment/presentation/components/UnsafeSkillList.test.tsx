import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import type {
  SecurityHistoryView,
  SecurityReportView,
  SecuritySkillView,
} from "../security-view.ts";
import { UnsafeSkillList } from "./UnsafeSkillList.tsx";

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
    scannedFiles: 1,
    threatLevel: "none",
    threatLevelDisplay: "none",
    summary: "ok",
    findings: [],
    branches: [{ name: "static", status: "complete" }],
    skippedFiles: [],
    ...overrides,
  };
}

function entry(
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

function finding(
  id: string,
  kindDisplay: string,
): SecurityReportView["findings"][number] {
  return {
    id,
    kind: "remote_execution",
    severity: "high",
    source: "static",
    kindDisplay,
    severityDisplay: "high",
    ruleName: "r",
    message: "m",
    remediation: "r",
    path: "a.js",
  };
}

const skills: readonly SecuritySkillView[] = [
  {
    skillRef: "skill:one",
    name: "one",
    agents: ["AiPy"],
    modifiedAt: "2026-08-10T00:00:00.000Z",
    source: "discovered",
  },
];

test("UnsafeSkillList shows only unsafe skills with danger/warn pills and report buttons", () => {
  const block = entry({
    id: "history:block",
    skillName: "blocker",
    report: report({ verdict: "block", findings: [finding("f1", "代码执行")] }),
  });
  const warn = entry({
    id: "history:warn",
    skillName: "warner",
    report: report({
      verdict: "warn",
      findings: [finding("f2", "密钥访问")],
    }),
  });
  const safe = entry({
    id: "history:safe",
    skillName: "safe-skill",
    report: report(),
  });

  const markup = renderToStaticMarkup(
    <UnsafeSkillList
      entries={[safe, block, warn]}
      skills={skills}
      onOpenReport={() => {}}
    />,
  );
  // Header row + 2 unsafe rows — safe skill is excluded.
  assert.equal((markup.match(/<tr/g) ?? []).length, 3);
  assert.match(markup, /blocker/);
  assert.match(markup, /warner/);
  assert.doesNotMatch(markup, /safe-skill/);
  // Confirmed warn/block verdicts share the same danger presentation.
  assert.match(markup, /bg-danger\/15/);
  assert.doesNotMatch(markup, /bg-amber-500\/15/);
  // Hit dimensions come from the real report findings.
  assert.match(markup, /代码执行/);
  assert.match(markup, /密钥访问/);
  assert.match(markup, /AiPy \/ one/);
  // Header + 2 enabled report buttons.
  assert.equal((markup.match(/查看报告/g) ?? []).length, 3);
});

test("UnsafeSkillList shows the empty state when every skill passed", () => {
  const markup = renderToStaticMarkup(
    <UnsafeSkillList
      entries={[
        entry({ report: report() }),
        entry({ id: "history:two", skillName: "two", report: report() }),
      ]}
      skills={skills}
      onOpenReport={() => {}}
    />,
  );
  assert.match(markup, /暂无不安全 Skill/);
  assert.doesNotMatch(markup, /<tr/);
});

test("UnsafeSkillList excludes incomplete and failed scans from confirmed risks", () => {
  const markup = renderToStaticMarkup(
    <UnsafeSkillList
      entries={[
        entry({
          id: "history:partial",
          skillName: "partial-skill",
          status: "partial",
          report: report({ status: "partial", verdict: "unknown" }),
        }),
        entry({
          id: "history:failed",
          skillName: "failed-skill",
          status: "failed",
        }),
      ]}
      skills={skills}
      onOpenReport={() => {}}
    />,
  );
  assert.doesNotMatch(markup, /partial-skill/);
  assert.doesNotMatch(markup, /failed-skill/);
  assert.match(markup, /暂无不安全 Skill/);
});
