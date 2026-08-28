import { LLM_SEVERITY_WEIGHTS } from "../types.js";
import type { Finding, ScanSkillReport, ThreatLevel } from "../types.js";

const DEFAULT_STATIC_WEIGHT: Record<Finding["severity"], number> = { critical: 45, high: 35, medium: 20, low: 10 };
const SEVERITY_ORDER: Record<Finding["severity"], number> = { critical: 4, high: 3, medium: 2, low: 1 };

/** Deduction-based: each ruleId of a static hit deducts its weight once; model findings deduct per-severity weight each. */
export function computeScore(findings: Finding[]): number {
  const ruleIds = new Set<string>();
  let deduction = 0;
  for (const item of findings) {
    if (item.source === "static") {
      if (item.ruleId && !ruleIds.has(item.ruleId)) { ruleIds.add(item.ruleId); deduction += item.weight ?? DEFAULT_STATIC_WEIGHT[item.severity]; }
    } else {
      deduction += item.weight ?? LLM_SEVERITY_WEIGHTS[item.severity];
    }
  }
  return Math.max(0, 100 - deduction);
}

export const threatLevelOf = (score: number): ThreatLevel => (score <= 20 ? "critical" : score <= 40 ? "high" : score <= 60 ? "medium" : score <= 80 ? "low" : "none");

export const SEVERITY_RANK: Record<Finding["severity"], number> = SEVERITY_ORDER;

/** verdict maps from the score; partial with zero findings → unknown (never judged allow). */
export const verdictOf = (score: number, partial: boolean, findings: Finding[]): ScanSkillReport["verdict"] => {
  if (partial && findings.length === 0) return "unknown";
  const level = threatLevelOf(score);
  return level === "critical" || level === "high" ? "block" : level === "medium" ? "warn" : "allow";
};
