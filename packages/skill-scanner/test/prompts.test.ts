import { describe, expect, it } from "vitest";
import { buildModelPrompts } from "../src/model/prompts.js";

describe("buildModelPrompts", () => {
  it("loads the English reference analysis prompts and exposes the aligned output shapes", () => {
    const p = buildModelPrompts();
    expect(p.single).toContain("Core judgment axiom");
    expect(p.multi).toContain("Core judgment axiom");
    expect(p.agentSystem).toBe(p.multi);
    expect(p.ruleReview).toContain("rule-hit verifier");
    expect(p.shapeFindings).toContain("risk_found");
    expect(p.shapeFindings).toContain("category");
    expect(p.shapeVerifications).toContain("is_true_positive");
    expect(p.shapeDedup).toBe("{duplicateRuleIndices:[number]}");
  });
  it("substitutes the file list and injects the agent tool protocol", () => {
    const p = buildModelPrompts();
    const fileList = '[{"path":"SKILL.md","lineCount":3,"chars":10}]';
    const task = p.agentTask(fileList);
    expect(task).toContain(fileList);
    expect(task).toContain("tool_call");
    expect(task).toContain("BehavioralRiskItem");
  });
});
