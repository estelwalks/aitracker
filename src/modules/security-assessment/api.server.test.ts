import assert from "node:assert/strict";
import test from "node:test";

import { findDtoDisclosureViolations } from "../../test-support/privacy-contract.ts";
import { assessmentFromSecurityReport } from "./adapters/scanner.ts";
import {
  createSecurityAssessmentServerApi,
  type SecurityAssessmentHistoryStore,
} from "./api.server.ts";
import { assessmentHistorySummary } from "./application/index.ts";
import type { AssetAssessment } from "./contracts.ts";

const assetRef = "asset:skill-demo" as const;
const report = {
  scannedAt: "2026-08-07T00:00:00.000Z",
  targetName: "SKILL.md",
  filesScanned: 1,
  verdict: "可疑" as const,
  riskScore: 88,
  durationMs: 1,
  rulesVersion: "builtin-v4",
  risks: [
    "远程命令执行",
    "数据泄露",
    "密钥泄露",
    "持久化",
    "破坏性操作",
    "代码混淆",
    "注入攻击",
    "权限提升",
    "文件访问",
    "网络外联",
    "提示注入",
  ].map((kind, index) => ({
    kind: kind as never,
    severity:
      index % 3 === 0
        ? ("高危" as const)
        : index % 3 === 1
          ? ("中危" as const)
          : ("低危" as const),
    source: "内置规则" as const,
    ruleName: `rule-${index}`,
    file: "/Users/alice/private/SKILL.md",
    line: index + 1,
    message: "do not publish",
    excerpt: "token=sk-super-secret-value",
  })),
};

function memoryStore(initial: AssetAssessment[] = []) {
  const values = [...initial];
  const store: SecurityAssessmentHistoryStore = {
    latest: async (ref) => values.find((item) => item.assetRef === ref),
    save: async (value) => {
      const index = values.findIndex(
        (item) => item.assetRef === value.assetRef,
      );
      if (index >= 0) values[index] = value;
      else values.push(value);
    },
    list: async () => values,
  };
  return { store, values };
}

test("maps all 11 rule dimensions to opaque findings", () => {
  const assessment = assessmentFromSecurityReport({
    assetRef,
    assetKind: "skill",
    report,
  });
  assert.equal(assessment.findings.length, 11);
  assert.equal(assessment.verdict, "suspicious");
  assert.equal(assessment.ruleVersion.version, "builtin-v4");
  assert.deepEqual(findDtoDisclosureViolations(assessment), []);
  const text = JSON.stringify(assessment);
  for (const forbidden of [
    "/Users/",
    "SKILL.md",
    "token=",
    "excerpt",
    "line",
    "do not publish",
  ])
    assert.equal(text.includes(forbidden), false, `leaks ${forbidden}`);
});

test("rejects arbitrary paths, uploads and unknown asset kinds before resolving", async () => {
  let resolved = 0;
  const memory = memoryStore();
  const api = createSecurityAssessmentServerApi({
    tasks: { runNow: async () => ({ ok: true, value: {} as never }) } as never,
    selection: {
      resolve: async () => {
        resolved += 1;
        return [];
      },
    },
    history: memory.store,
  });
  const result = await api.scan({
    assetRef,
    assetKind: "skill",
    selectionRef: "selection:/Users/alice/private" as never,
    path: "/Users/alice/private",
    upload: "data:text/plain,secret",
  });
  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "errors.security.invalidScanRequest");
  assert.equal(resolved, 0);
});

test("unknown scanner verdict remains unknown and publication stays fail-closed", () => {
  const assessment = assessmentFromSecurityReport({
    assetRef,
    assetKind: "skill",
    report: { ...report, verdict: "future" as never, risks: [] },
  });
  assert.equal(assessment.verdict, "unknown");
});

test("scan failure keeps the previous assessment and emits a stable code", async () => {
  const previous = assessmentFromSecurityReport({
    assetRef,
    assetKind: "skill",
    report: { ...report, verdict: "安全", risks: [] },
  });
  const memory = memoryStore([previous]);
  const api = createSecurityAssessmentServerApi({
    tasks: { runNow: async () => ({ ok: true, value: {} as never }) } as never,
    selection: {
      resolve: async () => [{ name: "SKILL.md", content: "source" }],
    },
    history: memory.store,
    scanner: () => {
      throw new Error(
        "raw path /Users/alice and token sk-secret must not escape",
      );
    },
  });
  const result = await api.scan({
    assetRef,
    assetKind: "skill",
    selectionRef: "selection:local-skill",
  });
  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "errors.security.scanFailed");
  assert.equal(memory.values[0], previous);
  assert.deepEqual(await api.history(), [assessmentHistorySummary(previous)]);
});

test("successful server adapter returns status/counts only; no network or source fields", async () => {
  let received = "";
  const memory = memoryStore();
  const api = createSecurityAssessmentServerApi({
    tasks: {
      runNow: async (request: unknown) => {
        assert.deepEqual(request, { taskId: "security.assessment.scan" });
        return { ok: true, value: {} as never };
      },
    } as never,
    selection: {
      resolve: async (ref) => {
        received = ref;
        return [{ name: "SKILL.md", content: "# safe" }];
      },
    },
    history: memory.store,
  });
  const result = await api.scan({
    assetRef,
    assetKind: "skill",
    selectionRef: "selection:local-skill",
  });
  assert.equal(received, "selection:local-skill");
  assert.equal(result.status, "succeeded");
  assert.equal(result.assessment?.verdict, "clean");
  assert.deepEqual(findDtoDisclosureViolations(result), []);
});
