/**
 * Per-tool pricing policy (v1.5).
 *
 * Each tool declares `billingMode` + `fallbackProfileRef` in its JSON
 * definition (P4-T5) so an unknown model always has a defined outcome (never a
 * silent $0). The policy is derived from the registry's pricing metadata;
 * `rulePackRefs` feed the resolver's pack selection.
 */
import type { ToolPricingPolicy } from "./contracts.ts";
import { getPricingPolicyRefs } from "../tool-registry/registry.ts";

const UNSUPPORTED: ToolPricingPolicy = {
  billingMode: "unsupported",
  rulePackRefs: [],
  fallbackProfileRef: "unpriced-v1",
  reasoningPolicy: "ignore",
};

export function getToolPricingPolicy(toolId: string): ToolPricingPolicy {
  const refs = getPricingPolicyRefs(toolId);
  if (!refs?.billingMode) return UNSUPPORTED;
  return {
    billingMode: refs.billingMode,
    rulePackRefs: [...refs.rulePackRefs],
    fallbackProfileRef: refs.fallbackProfileRef ?? "unpriced-v1",
    reasoningPolicy: "ignore",
  };
}
