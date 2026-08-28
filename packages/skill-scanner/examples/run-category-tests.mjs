#!/usr/bin/env node
// Category coverage test: scans every sample under examples/samples/ with the in-memory
// scanner (quick mode, deterministic) and writes a final JSON report.
//
// Usage: node examples/run-category-tests.mjs [output.json]
//   default output: examples/samples/category-report.json

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanSkill, ENGINE_VERSION, RULES_VERSION } from "../dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES_ROOT = path.join(__dirname, "samples");
const DEFAULT_OUTPUT = path.join(SAMPLES_ROOT, "category-report.json");
const outputPath = process.argv[2] ?? DEFAULT_OUTPUT;

/** Expected outcome per sample: kind=at least one finding of that risk kind; ruleId=at least one hit of that rule; clean=zero findings. */
const SAMPLES = [
  { dir: "remote-execution", label: "远程命令执行", expect: { kind: "remote_execution" } },
  { dir: "command-injection", label: "命令注入", expect: { kind: "command_injection" } },
  { dir: "data-exfiltration", label: "数据泄露", expect: { kind: "data_exfiltration" } },
  { dir: "secret-leak", label: "密钥泄露", expect: { kind: "secret_access" } },
  { dir: "persistence", label: "持久化", expect: { kind: "persistence" } },
  { dir: "destructive", label: "破坏性操作", expect: { kind: "destructive" } },
  { dir: "obfuscation", label: "代码混淆", expect: { kind: "obfuscation" } },
  { dir: "privilege-escalation", label: "权限提升", expect: { kind: "privilege_escalation" } },
  { dir: "file-access", label: "文件访问", expect: { kind: "sensitive_file_access" } },
  { dir: "network-abuse", label: "网络外联", expect: { kind: "network_abuse" } },
  { dir: "prompt-injection", label: "提示注入", expect: { kind: "prompt_injection" } },
  { dir: "normal-simple", label: "正常·纯文档", expect: { clean: true } },
  { dir: "normal-script", label: "正常·含脚本", expect: { clean: true } },
  { dir: "binary-payload", label: "风险文件(.exe)", expect: { ruleId: "RISK_FILE" } },
  { dir: "long-hidden", label: "超长文件藏匿", expect: { ruleId: "LONG_FILE" } },
];

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function checkExpected(expect, report) {
  if (expect.kind) return report.findings.some((f) => f.kind === expect.kind);
  if (expect.ruleId) return report.findings.some((f) => f.ruleId === expect.ruleId);
  if (expect.clean) return report.findings.length === 0;
  return false;
}

const results = [];
for (const sample of SAMPLES) {
  const dir = path.join(SAMPLES_ROOT, sample.dir);
  const files = walk(dir).map((f) => {
    const buf = fs.readFileSync(f);
    const isBinary = buf.includes(0);
    return { path: path.relative(dir, f), content: isBinary ? "" : buf.toString("utf-8"), ...(isBinary ? { isBinary: true } : {}) };
  });
  const report = await scanSkill({ mode: "quick", files });
  const detected = checkExpected(sample.expect, report);
  results.push({
    name: sample.dir,
    label: sample.label,
    expected: sample.expect,
    detected,
    status: report.status,
    verdict: report.verdict,
    threatLevel: report.threatLevel,
    threatLevelDisplay: report.threatLevelDisplay,
    riskScore: report.riskScore,
    findings: report.findings,
    skippedFiles: report.skippedFiles,
  });
  console.log(`${detected ? "✓" : "✗"} ${sample.label.padEnd(12)} ${sample.dir}  verdict=${report.verdict} score=${report.riskScore}`);
}

const kindSamples = results.filter((r) => "kind" in r.expected);
const cleanSamples = results.filter((r) => r.expected.clean);
const specialSamples = results.filter((r) => !("kind" in r.expected) && !r.expected.clean);

const coverage = {};
for (const r of kindSamples) coverage[r.expected.kind] = r.detected ? "detected" : "missed";

const final = {
  engine: { name: "skill-scanner", engineVersion: ENGINE_VERSION, rulesVersion: RULES_VERSION },
  generatedAt: new Date().toISOString(),
  mode: "quick",
  note: "quick 静态扫描（规则 + 文件级检查），确定性覆盖参考实现的 11 类风险；full 的模型语义分析另行验证。",
  summary: {
    totalSamples: results.length,
    kindSamples: { total: kindSamples.length, detected: kindSamples.filter((r) => r.detected).length, missed: kindSamples.filter((r) => !r.detected).length },
    cleanSamples: { total: cleanSamples.length, passed: cleanSamples.filter((r) => r.detected).length, falsePositives: cleanSamples.filter((r) => !r.detected).length },
    specialSamples: { total: specialSamples.length, detected: specialSamples.filter((r) => r.detected).length, missed: specialSamples.filter((r) => !r.detected).length },
    coverageByKind: coverage,
    allPassed: results.every((r) => r.detected),
  },
  results,
};

fs.writeFileSync(outputPath, JSON.stringify(final, null, 2));
console.log(`\n=== 类别覆盖 ===`);
for (const [kind, state] of Object.entries(coverage)) console.log(`  ${state === "detected" ? "✓" : "✗"} ${kind}  ${state}`);
console.log(`\n${final.summary.kindSamples.detected}/${final.summary.kindSamples.total} 风险类别检出；正常样本误报 ${final.summary.cleanSamples.falsePositives}；特殊样本检出 ${final.summary.specialSamples.detected}/${final.summary.specialSamples.total}`);
console.log(`\n最终结果文件已写入: ${outputPath}`);
