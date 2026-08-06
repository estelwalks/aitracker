/**
 * Per-tool pricing policy (v1.5).
 *
 * P1-1 phase-1 compat shim: tools no longer declare `billingMode` /
 * `fallbackProfileRef` / `rulePackRefs` (billing ownership moved to billing
 * routes). Until phase 2 rewrites resolve/calculate to consume the new
 * contracts, the policy is derived from the registry's usage capability -
 * matching the legacy derivation exactly (usage-capable -> api-metered +
 * unpriced-v1 fallback, else unsupported). TODO(P1-1 phase 2): remove this
 * shim together with `ToolPricingPolicy` and drive resolve from billing
 * routes + model observation.
 */
import type { ToolPricingPolicy } from "./contracts.ts";
import {
  getPricingPolicyRefs,
  getUsagePlan,
} from "../tool-registry/registry.ts";

const UNSUPPORTED: ToolPricingPolicy = {
  billingMode: "unsupported",
  rulePackRefs: [],
  fallbackProfileRef: "unpriced-v1",
  reasoningPolicy: "ignore",
};

export function getToolPricingPolicy(toolId: string): ToolPricingPolicy {
  // Legacy path kept for any consumer that still projects old pricing fields
  // (never hit after the P1-1 JSON migration; removed in phase 2).
  const refs = getPricingPolicyRefs(toolId);
  if (refs?.billingMode) {
    return {
      billingMode: refs.billingMode,
      rulePackRefs: [...refs.rulePackRefs],
      fallbackProfileRef: refs.fallbackProfileRef ?? "unpriced-v1",
      reasoningPolicy: "ignore",
    };
  }
  // P1-1 shim: usage-capable tools are api-metered with unpriced-v1 fallback;
  // tools without a usage plan are unsupported (never a silent $0).
  const plan = getUsagePlan(toolId);
  if (!plan) return UNSUPPORTED;
  return {
    billingMode: "api-metered",
    rulePackRefs: [],
    fallbackProfileRef: "unpriced-v1",
    reasoningPolicy: "ignore",
  };
}
