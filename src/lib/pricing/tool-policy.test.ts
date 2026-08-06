/**
 * P4-T5: per-tool pricing policy derives from the registry's JSON pricing
 * metadata (billingMode/fallbackProfileRef/rulePackRefs), matching the legacy
 * derivation (usage-capable -> api-metered, else unsupported).
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { getToolPricingPolicy } from "./tool-policy.ts";
import { getUsagePlan } from "../tool-registry/registry.ts";

describe("getToolPricingPolicy (P4-T5)", () => {
  test("usage-capable tools are api-metered with unpriced-v1 fallback", () => {
    for (const id of [
      "claude-code",
      "codex",
      "cursor",
      "grok",
      "aipy",
      "cline",
    ]) {
      const policy = getToolPricingPolicy(id);
      assert.equal(policy.billingMode, "api-metered", id);
      assert.equal(policy.fallbackProfileRef, "unpriced-v1", id);
    }
  });

  test("tools without a usage plan are unsupported", () => {
    for (const id of ["openclaw", "pi", "zed"]) {
      assert.equal(getUsagePlan(id), null, `${id} should have no usage plan`);
      assert.equal(getToolPricingPolicy(id).billingMode, "unsupported", id);
    }
  });

  test("every catalog tool has a defined policy (never a silent $0)", () => {
    for (const id of [
      "claude-code",
      "codex",
      "cursor",
      "kiro",
      "gemini-cli",
      "opencode",
      "openclaw",
      "every-code",
      "hermes",
      "github-copilot",
      "kimi-code",
      "omp",
      "codebuddy",
      "workbuddy",
      "grok",
      "kilo-cli",
      "kilocode",
      "antigravity",
      "pi",
      "craft",
      "roo-code",
      "zed",
      "goose",
      "droid",
      "mimo",
      "zcode",
      "anythingllm",
      "aipy",
      "cline",
    ]) {
      const policy = getToolPricingPolicy(id);
      assert.ok(
        ["api-metered", "unsupported"].includes(policy.billingMode),
        `${id}: unexpected billingMode ${policy.billingMode}`,
      );
      assert.equal(policy.reasoningPolicy, "ignore");
    }
  });

  test("unknown tool id falls back to unsupported", () => {
    assert.equal(
      getToolPricingPolicy("no-such-tool").billingMode,
      "unsupported",
    );
  });
});
