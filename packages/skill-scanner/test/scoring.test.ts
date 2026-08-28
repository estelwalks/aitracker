import { describe, expect, it } from "vitest";
import { computeScore, threatLevelOf, verdictOf } from "../src/detection/scoring.js";
import type { Finding, Severity } from "../src/types.js";

/** Builds a valid Finding with a configurable weight (omit to exercise default-weight fallback). */
function finding(over: Partial<Finding> & { source: Finding["source"]; severity: Severity; weight?: number }): Finding {
  return {
    id: "f", kind: "remote_execution", severity: over.severity, source: over.source,
    kindDisplay: "k", severityDisplay: "s", ruleName: "r", message: "m", remediation: "r",
    weight: over.weight as number, path: "SKILL.md", ...(over.ruleId ? { ruleId: over.ruleId } : {}),
  } as Finding;
}

describe("computeScore", () => {
  it("deducts a static rule weight once per ruleId", () => {
    const score = computeScore([
      finding({ source: "static", severity: "high", weight: 45, ruleId: "a" }),
      finding({ source: "static", severity: "high", weight: 45, ruleId: "a" }),
    ]);
    expect(score).toBe(55);
  });
  it("deducts model findings per severity weight", () => {
    const score = computeScore([
      finding({ source: "model", severity: "high", weight: 35 }),
      finding({ source: "model", severity: "low", weight: 10 }),
    ]);
    expect(score).toBe(55);
  });
  it("uses the reference critical model-finding weight", () => {
    expect(computeScore([finding({ source: "model", severity: "critical" })])).toBe(55);
  });
  it("falls back to default weights when a finding has no weight", () => {
    expect(computeScore([finding({ source: "static", severity: "high", ruleId: "a" })])).toBe(65); // 100 − 35
    expect(computeScore([finding({ source: "model", severity: "medium" })])).toBe(75); // 100 − 25
  });
  it("clamps the score at 0", () => {
    const score = computeScore([
      finding({ source: "static", severity: "high", weight: 45, ruleId: "a" }),
      finding({ source: "static", severity: "high", weight: 45, ruleId: "b" }),
      finding({ source: "static", severity: "high", weight: 45, ruleId: "c" }),
    ]);
    expect(score).toBe(0);
  });
  it("returns 100 for a clean scan", () => {
    expect(computeScore([])).toBe(100);
  });
});

describe("threatLevelOf", () => {
  it("maps score bands to threat levels", () => {
    expect(threatLevelOf(0)).toBe("critical");
    expect(threatLevelOf(20)).toBe("critical");
    expect(threatLevelOf(21)).toBe("high");
    expect(threatLevelOf(40)).toBe("high");
    expect(threatLevelOf(41)).toBe("medium");
    expect(threatLevelOf(60)).toBe("medium");
    expect(threatLevelOf(61)).toBe("low");
    expect(threatLevelOf(80)).toBe("low");
    expect(threatLevelOf(81)).toBe("none");
    expect(threatLevelOf(100)).toBe("none");
  });
});

describe("verdictOf", () => {
  it("returns unknown for a partial scan with no findings", () => {
    expect(verdictOf(100, true, [])).toBe("unknown");
  });
  it("maps threat levels to block/warn/allow", () => {
    expect(verdictOf(0, false, [finding({ source: "model", severity: "high" })])).toBe("block");
    expect(verdictOf(30, false, [finding({ source: "model", severity: "high" })])).toBe("block");
    expect(verdictOf(50, false, [finding({ source: "model", severity: "medium" })])).toBe("warn");
    expect(verdictOf(90, false, [finding({ source: "model", severity: "low" })])).toBe("allow");
  });
});
