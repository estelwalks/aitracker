import { z } from "zod";
import { askModel } from "../model/client.js";
import { buildModelPrompts } from "../model/prompts.js";
import type { Finding, FetchLike, ModelConfig } from "../types.js";
import type { TokenUsageCollector } from "../model/usage.js";

/** Exact reference location dedup: rules win; each side keeps the highest weight at a concrete path+line. */
export function dedupByLocation(ruleFindings: Finding[], modelFindings: Finding[]): { rules: Finding[]; model: Finding[] } {
  const bestRules = new Map<string, Finding>();
  const fileLevelRules: Finding[] = [];
  for (const item of ruleFindings) {
    if (item.line === undefined) {
      fileLevelRules.push(item);
      continue;
    }
    const key = `${item.path}:${item.line}`;
    const existing = bestRules.get(key);
    if (!existing || item.weight > existing.weight) bestRules.set(key, item);
  }
  const bestModel = new Map<string, Finding>();
  for (const item of modelFindings) {
    const key = `${item.path}:${item.line ?? 0}`;
    if (item.line !== undefined && bestRules.has(key)) continue;
    const existing = bestModel.get(key);
    if (!existing || item.weight > existing.weight) bestModel.set(key, item);
  }
  return { rules: [...bestRules.values(), ...fileLevelRules], model: [...bestModel.values()] };
}

export function dedupModel(modelFindings: Finding[], ruleFindings: Finding[]): Finding[] {
  return dedupByLocation(ruleFindings, modelFindings).model;
}

const DedupDecisionSchema = z.object({ duplicateRuleIndices: z.array(z.number().int().nonnegative()).max(100) }).strict();

/** LLM semantic dedup: after location dedup, a lite model judges whether a rule hit and a model finding describe the same risk (model wins); on failure, everything is kept. */
export async function semanticDedup(fetcher: FetchLike, model: ModelConfig, ruleFindings: Finding[], modelFindings: Finding[], usageCollector?: TokenUsageCollector): Promise<Finding[]> {
  if (ruleFindings.length === 0 || modelFindings.length === 0) return ruleFindings;
  const prompts = buildModelPrompts();
  try {
    const decision = await askModel(fetcher, model, model.liteModel, prompts.dedup, {
      primary: modelFindings.map((f, index) => ({ index, kind: f.kind, severity: f.severity, path: f.path, line: f.line, message: f.message })),
      secondary: ruleFindings.map((f, index) => ({ index, ruleId: f.ruleId, ruleName: f.ruleName, kind: f.kind, path: f.path, line: f.line, message: f.message })),
    }, prompts.shapeDedup, DedupDecisionSchema, undefined, usageCollector ? { collector: usageCollector, context: { model: model.liteModel, branch: "semanticDedup" } } : undefined);
    const drop = new Set(decision.duplicateRuleIndices);
    return ruleFindings.filter((_, i) => !drop.has(i));
  } catch {
    return ruleFindings;
  }
}
