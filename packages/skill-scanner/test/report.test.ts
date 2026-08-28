import { describe, expect, it } from "vitest";
import { asFindings, buildCategories, buildContext, buildRuleAggregations, buildSummary } from "../src/detection/report.js";
import type { BehavioralRiskItem } from "../src/model/client.js";
import type { Finding, SkillFile } from "../src/types.js";

function finding(over: Partial<Finding> & { kind: Finding["kind"]; severity: Finding["severity"] }): Finding {
  return {
    id: "f", kind: over.kind, severity: over.severity, source: over.source ?? "static",
    kindDisplay: over.kindDisplay ?? "k", severityDisplay: "s", ruleName: "r", message: "m", remediation: "r",
    weight: over.weight ?? 25, path: over.path ?? "SKILL.md", ...(over.ruleId ? { ruleId: over.ruleId } : {}),
    ...(over.line ? { line: over.line } : {}), ...(over.fileHash ? { fileHash: over.fileHash } : {}),
  };
}

const oneFile: SkillFile[] = [{ path: "SKILL.md", content: "line 1\nline 2\nline 3\nline 4\nline 5", isBinary: false }];

describe("buildCategories", () => {
  it("groups findings by kind with count, highest severity, total weight and display", () => {
    const cats = buildCategories([
      finding({ kind: "remote_execution", severity: "high", weight: 45 }),
      finding({ kind: "remote_execution", severity: "medium", weight: 20 }),
      finding({ kind: "command_injection", severity: "high", weight: 45 }),
    ], "en-US");
    expect(cats.remote_execution).toEqual({ count: 2, highestSeverity: "high", totalWeight: 65, display: "Remote Code/Command Execution" });
    expect(cats.command_injection).toEqual({ count: 1, highestSeverity: "high", totalWeight: 45, display: "Command Injection" });
  });
  it("returns an empty map for no findings", () => {
    expect(buildCategories([], "en-US")).toEqual({});
  });
});

describe("buildRuleAggregations", () => {
  it("aggregates static findings by ruleId with match details including fileHash", () => {
    const rules = buildRuleAggregations([
      finding({ kind: "remote_execution", severity: "high", weight: 45, ruleId: "builtin-01", line: 1, fileHash: "abc123" }),
      finding({ kind: "remote_execution", severity: "high", weight: 45, ruleId: "builtin-01", line: 2, fileHash: "abc123" }),
    ], "en-US");
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ ruleId: "builtin-01", count: 2, kind: "remote_execution", severity: "high", weight: 45 });
    expect(rules[0].matches.map((m) => m.line)).toEqual([1, 2]);
    expect(rules[0].matches[0].fileHash).toBe("abc123");
  });
});

describe("buildContext", () => {
  it("slices ±2 lines around the hit line with line-number prefixes", () => {
    expect(buildContext(oneFile, "SKILL.md", 3)).toBe("1: line 1\n2: line 2\n3: line 3\n4: line 4\n5: line 5");
    expect(buildContext(oneFile, "SKILL.md", 5)).toBe("3: line 3\n4: line 4\n5: line 5");
  });
  it("returns an empty string without a line or a known file", () => {
    expect(buildContext(oneFile, "SKILL.md")).toBe("");
    expect(buildContext(oneFile, "missing.md", 1)).toBe("");
    expect(buildContext([], "SKILL.md", 1)).toBe("");
  });
});

describe("buildSummary", () => {
  it("renders a clean summary in the requested locale", () => {
    expect(buildSummary(2, [], "zh-CN")).toBe("扫描了 2 个文件，未发现安全问题。");
    expect(buildSummary(1, [], "en-US")).toBe("Scanned 1 file(s), no security issues found.");
  });
  it("renders found categories and severity counts", () => {
    const s = buildSummary(3, [
      finding({ kind: "remote_execution", severity: "high", kindDisplay: "远程代码/命令执行" }),
      finding({ kind: "command_injection", severity: "medium", kindDisplay: "命令注入" }),
    ], "zh-CN");
    expect(s).toContain("扫描了 3 个文件");
    expect(s).toContain("远程代码/命令执行");
    expect(s).toContain("命令注入");
    expect(s).toContain("高危");
  });
});

describe("asFindings", () => {
  const riskItem = (over: Partial<BehavioralRiskItem> = {}): BehavioralRiskItem => ({
    index: 0, category: "remote_execution", severity: "high", file_path: "SKILL.md", line_number: 2,
    name: "", name_zh: "", description: "m", description_zh: "", remediation: "", remediation_zh: "", reasoning: "r",
    ...over,
  });
  it("normalizes raw behavioral findings into localized Finding objects", () => {
    const hashes = new Map([["SKILL.md", "f".repeat(64)]]);
    const out = asFindings([riskItem()], oneFile, "single", "en-US", hashes);
    expect(out[0]).toMatchObject({ kind: "remote_execution", severity: "high", source: "model", path: "SKILL.md", line: 2, ruleName: "Model finding", kindDisplay: "Remote Code/Command Execution", fileHash: "f".repeat(64), reasoning: "r" });
  });
  it("uses the Chinese bilingual fields for the zh-CN locale", () => {
    const out = asFindings([riskItem({ description: "en desc", description_zh: "中文描述", remediation: "en fix", remediation_zh: "中文修复" })], oneFile, "single", "zh-CN");
    expect(out[0].message).toBe("中文描述");
    expect(out[0].remediation).toBe("中文修复");
  });
  it("drops unclassifiable categories and findings on non-scanned files; falls back only for missing file_path", () => {
    expect(asFindings([riskItem({ category: "weird" })], oneFile, "single", "en-US")).toHaveLength(0);
    expect(asFindings([riskItem({ file_path: "skill-check/references/attack_patterns.md" })], oneFile, "single", "en-US")).toHaveLength(0);
    expect(asFindings([riskItem({ file_path: "" })], oneFile, "single", "en-US")[0].path).toBe("SKILL.md");
  });
  it("redacts secrets in messages", () => {
    const out = asFindings([riskItem({ description: "leaked token=sk-abcdefghijklmnopqrstuvwxyz" })], oneFile, "single", "en-US");
    expect(out[0].message).toContain("[REDACTED]");
  });
});
