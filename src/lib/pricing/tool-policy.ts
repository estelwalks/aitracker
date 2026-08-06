/**
 * Per-tool pricing policy (v1.5).
 *
 * Each tool declares `billingMode` + `fallbackProfileRef` so an unknown model
 * always has a defined outcome (never a silent $0). Until the tool-registry is
 * rewritten to JSON (Phase 3), the policy is derived from the v1.1 registry's
 * usage capability + the legacy/external adapter sources (aipy/cline/custom:*)
 * that produce billable events but are not in the 27-tool catalog.
 */
import type { ToolPricingPolicy } from "./contracts.ts";
import { getUsagePlan } from "../tool-registry/registry.ts";

const API_METERED: ToolPricingPolicy = {
  billingMode: "api-metered",
  rulePackRefs: [],
  fallbackProfileRef: "unpriced-v1",
  reasoningPolicy: "ignore",
};

const UNSUPPORTED: ToolPricingPolicy = {
  billingMode: "unsupported",
  rulePackRefs: [],
  fallbackProfileRef: "unpriced-v1",
  reasoningPolicy: "ignore",
};

/** Legacy/external adapter sources that produce billable events but lack a registry config. */
const LEGACY_BILLABLE_SOURCES = new Set(["aipy", "cline"]);

export function getToolPricingPolicy(toolId: string): ToolPricingPolicy {
  if (
    getUsagePlan(toolId) ||
    LEGACY_BILLABLE_SOURCES.has(toolId) ||
    toolId.startsWith("custom:")
  ) {
    return API_METERED;
  }
  return UNSUPPORTED;
}
