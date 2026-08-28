import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { BehavioralRiskItem } from "../src/model/client.js";
import {
  LOCALES,
  ScanSkillReportSchema,
  scanSkill,
  type LocaleKey,
  type ScanSkillReport,
} from "../src/index.js";

const FIXTURES_ROOT = resolve("test/fixtures/realistic");
const fixture = (polarity: "positive" | "negative", name: string): string =>
  resolve(FIXTURES_ROOT, polarity, name);

interface PositiveFixture {
  name: string;
  ruleIds: string[];
  kinds: string[];
  riskScore: number;
  threatLevel: ScanSkillReport["threatLevel"];
  verdict: ScanSkillReport["verdict"];
}

const POSITIVE_FIXTURES: PositiveFixture[] = [
  {
    name: "secret-exfiltration",
    ruleIds: ["CURL_POST_DOMAIN", "READ_AWS_CREDS"],
    kinds: ["data_exfiltration", "sensitive_file_access"],
    riskScore: 20,
    threatLevel: "critical",
    verdict: "block",
  },
  {
    name: "remote-download-execute",
    ruleIds: ["CURL_PIPE_SH_DOMAIN"],
    kinds: ["remote_execution"],
    riskScore: 90,
    threatLevel: "none",
    verdict: "allow",
  },
  {
    name: "persistence",
    ruleIds: ["SSH_KEYS_WRITE"],
    kinds: ["persistence"],
    riskScore: 10,
    threatLevel: "critical",
    verdict: "block",
  },
  {
    name: "destructive-privilege",
    ruleIds: ["RM_RF_ROOT", "SUDOERS_MODIFY"],
    kinds: ["destructive", "privilege_escalation"],
    riskScore: 0,
    threatLevel: "critical",
    verdict: "block",
  },
  {
    name: "obfuscated-execution",
    ruleIds: ["BASE64_DECODE_EXEC"],
    kinds: ["obfuscation"],
    riskScore: 40,
    threatLevel: "high",
    verdict: "block",
  },
  {
    name: "prompt-injection",
    ruleIds: ["IGNORE_INSTRUCTIONS"],
    kinds: ["prompt_injection"],
    riskScore: 40,
    threatLevel: "high",
    verdict: "block",
  },
  {
    name: "multi-file-chain",
    ruleIds: ["HTTP_REQUEST"],
    kinds: ["data_exfiltration"],
    riskScore: 90,
    threatLevel: "none",
    verdict: "allow",
  },
];

const NEGATIVE_FIXTURES = [
  "devops-release",
  "documentation",
  "http-health-check",
  "placeholders",
  "safe-installer",
] as const;

const sorted = (values: Iterable<string>): string[] => [...values].sort();

describe("realistic quick-scan fixtures", () => {
  for (const sample of POSITIVE_FIXTURES) {
    it(`detects ${sample.name} with stable rules, categories, score and aggregation`, async () => {
      const report = await scanSkill({ mode: "quick", locale: "en-US", paths: [fixture("positive", sample.name)] });
      const staticFindings = report.findings.filter((finding) => finding.source === "static");

      expect(ScanSkillReportSchema.safeParse(report).success).toBe(true);
      expect(report).toMatchObject({
        status: "complete",
        mode: "quick",
        locale: "en-US",
        riskScore: sample.riskScore,
        threatLevel: sample.threatLevel,
        verdict: sample.verdict,
      });
      expect(sorted(staticFindings.map((finding) => finding.ruleId ?? ""))).toEqual(sorted(sample.ruleIds));
      expect(sorted(new Set(staticFindings.map((finding) => finding.kind)))).toEqual(sorted(sample.kinds));
      expect(sorted(Object.keys(report.categories))).toEqual(sorted(sample.kinds));
      expect(report.rules).toHaveLength(sample.ruleIds.length);

      for (const ruleId of sample.ruleIds) {
        const matches = staticFindings.filter((finding) => finding.ruleId === ruleId);
        const aggregate = report.rules.find((rule) => rule.ruleId === ruleId);
        expect(aggregate, `${sample.name}:${ruleId}`).toBeDefined();
        expect(aggregate?.count).toBe(matches.length);
        expect(aggregate?.matches).toHaveLength(matches.length);
        expect(aggregate?.matches.every((match) => match.path.startsWith(fixture("positive", sample.name)))).toBe(true);
      }
    });
  }

  for (const name of NEGATIVE_FIXTURES) {
    it(`does not flag the legitimate ${name} fixture`, async () => {
      const report = await scanSkill({ mode: "quick", locale: "en-US", paths: [fixture("negative", name)] });

      expect(report).toMatchObject({
        status: "complete",
        mode: "quick",
        verdict: "allow",
        riskScore: 100,
        threatLevel: "none",
        findings: [],
        rules: [],
        categories: {},
      });
      expect(report.skippedFiles).toEqual([]);
    });
  }
});

describe("realistic full-scan routing", () => {
  const model = {
    endpoint: "https://model.example/v1",
    apiKey: "fixture-only-key",
    liteModel: "lite",
    proModel: "pro",
    timeoutMs: 1_000,
  };

  const openaiReply = (payload: unknown): Response =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }), { status: 200 });

  it("routes a realistic multi-file chain through the agent and preserves static aggregation", async () => {
    const sampleDir = fixture("positive", "multi-file-chain");
    const skillPath = resolve(sampleDir, "SKILL.md");
    const requestedTasks: string[] = [];
    const modelFinding: BehavioralRiskItem = {
      index: 0,
      category: "data_exfiltration",
      severity: "high",
      file_path: skillPath,
      line_number: 9,
      name: "Cross-file collection and upload",
      name_zh: "跨文件收集并上传",
      description: "The collection result is passed to an external upload helper.",
      description_zh: "收集结果被传递给外部上传辅助程序。",
      remediation: "Keep inventory local or use an approved, authenticated endpoint.",
      remediation_zh: "将清单保留在本地，或使用经过批准且已认证的端点。",
      reasoning: "The source and sink are split across two helper files.",
    };
    const fetchMock = async (_url: string, init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
      const task = String(body.messages[1]?.content ?? "");
      requestedTasks.push(task);
      if (task.startsWith("Please verify each of the following rule hits")) {
        return openaiReply({ verifications: [{ index: 0, is_true_positive: true, reasoning: "network sink is present" }] });
      }
      if (task.startsWith("Perform a behavioral security analysis of the following SKILL directory to find")) {
        return openaiReply({ type: "final", risk_found: true, findings: [modelFinding] });
      }
      if (task.startsWith("Determine whether rule hits")) {
        return openaiReply({ duplicateRuleIndices: [] });
      }
      throw new Error(`unexpected model task: ${task.slice(0, 80)}`);
    };

    const report = await scanSkill(
      { mode: "full", locale: "en-US", paths: [sampleDir], model },
      { fetch: fetchMock },
    );

    expect(report.status).toBe("complete");
    expect(report.branches).toEqual([
      { name: "static", status: "complete" },
      { name: "ruleReview", status: "complete" },
      { name: "singleFileAnalysis", status: "skipped", detail: "multi-file input" },
      { name: "multiFileAnalysis", status: "complete" },
    ]);
    expect(requestedTasks.some((task) => task.startsWith("Perform a behavioral security analysis of the following SKILL content"))).toBe(false);
    expect(report.findings.some((finding) => finding.source === "model" && finding.message === modelFinding.description)).toBe(true);
    expect(report.rules.find((rule) => rule.ruleId === "HTTP_REQUEST")?.count).toBe(1);
    expect(report.categories.data_exfiltration).toMatchObject({ count: 2, highestSeverity: "high", totalWeight: 45 });
    expect(report.riskScore).toBe(55);
    expect(report.threatLevel).toBe("medium");
    expect(report.verdict).toBe("warn");
  });
});

describe("realistic fixture i18n stability", () => {
  const canonicalProjection = (report: ScanSkillReport) => ({
    status: report.status,
    mode: report.mode,
    verdict: report.verdict,
    riskScore: report.riskScore,
    contentHash: report.contentHash,
    scannedFiles: report.scannedFiles,
    threatLevel: report.threatLevel,
    categories: Object.fromEntries(
      Object.entries(report.categories).map(([kind, bucket]) => [kind, {
        count: bucket.count,
        highestSeverity: bucket.highestSeverity,
        totalWeight: bucket.totalWeight,
      }]),
    ),
    findings: report.findings.map((finding) => ({
      id: finding.id,
      kind: finding.kind,
      severity: finding.severity,
      source: finding.source,
      ruleId: finding.ruleId,
      weight: finding.weight,
      cweId: finding.cweId,
      path: finding.path,
      line: finding.line,
      fileHash: finding.fileHash,
    })),
    rules: report.rules.map((rule) => ({
      ruleId: rule.ruleId,
      kind: rule.kind,
      severity: rule.severity,
      weight: rule.weight,
      cweId: rule.cweId,
      count: rule.count,
      matches: rule.matches,
    })),
    branches: report.branches,
    skippedFiles: report.skippedFiles,
  });

  it("changes localized copy without changing canonical findings or report structure", async () => {
    const reports = await Promise.all(
      LOCALES.map((locale: LocaleKey) => scanSkill({
        mode: "quick",
        locale,
        paths: [fixture("positive", "secret-exfiltration")],
      })),
    );
    const baseline = canonicalProjection(reports[0]);

    for (const report of reports) {
      expect(ScanSkillReportSchema.safeParse(report).success).toBe(true);
      expect(canonicalProjection(report)).toEqual(baseline);
      expect(Object.keys(report)).toEqual(Object.keys(reports[0]));
      expect(Object.keys(report.findings[0])).toEqual(Object.keys(reports[0].findings[0]));
    }
    expect(new Set(reports.map((report) => report.summary)).size).toBe(LOCALES.length);
    expect(new Set(reports.map((report) => report.findings[0]?.ruleName)).size).toBe(LOCALES.length);
  });
});
