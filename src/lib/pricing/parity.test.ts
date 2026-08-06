import assert from "node:assert/strict";
import test from "node:test";

import type { PricingLookupInput, ToolPricingPolicy } from "./contracts.ts";
import { compilePricingRegistry } from "./compile.ts";
import { resolvePrice } from "./resolve.ts";
import {
  PRICING_PACKS,
  PRICING_REGISTRY_VERSION,
} from "./pricing-definitions.generated.ts";
import { BASELINE_MODEL_PRICES } from "../tool-registry/__baseline__/baseline.ts";

const registry = compilePricingRegistry(
  PRICING_PACKS,
  PRICING_REGISTRY_VERSION,
);

const policy: ToolPricingPolicy = {
  billingMode: "api-metered",
  rulePackRefs: [],
  fallbackProfileRef: "unpriced-v1",
  reasoningPolicy: "ignore",
};

function inputOnly(model: string, input = 1_000_000n): PricingLookupInput {
  return {
    toolId: "codex",
    rawModel: model,
    occurredAt: "2026-07-28T00:00:00.000Z",
    tokens: {
      input,
      output: 0n,
      cacheRead: 0n,
      cacheWrite: 0n,
      reasoningOutput: 0n,
    },
  };
}

/** Every frozen baseline MODEL_PRICES entry must reproduce its input rate. */
test("baseline MODEL_PRICES: all 12 reproduce exactly via the rule-pack resolver", () => {
  for (const bp of BASELINE_MODEL_PRICES) {
    const model =
      bp.matcher.kind === "exactOrSnapshot"
        ? bp.matcher.names[0]
        : bp.matcher.parts.join("-");
    const res = resolvePrice(registry, inputOnly(model), policy);
    const expected = BigInt(Math.round(bp.inputUsdPerMillion * 1_000_000_000));
    assert.equal(
      res.confidence,
      "exact",
      `${model}: expected exact, got ${res.confidence}`,
    );
    assert.equal(res.knownUsdNano, expected, `${model}: expected ${expected}`);
  }
});

test("baseline MODEL_PRICES: output rates reproduce", () => {
  for (const bp of BASELINE_MODEL_PRICES) {
    const model =
      bp.matcher.kind === "exactOrSnapshot"
        ? bp.matcher.names[0]
        : bp.matcher.parts.join("-");
    const res = resolvePrice(
      registry,
      {
        ...inputOnly(model),
        tokens: {
          input: 0n,
          output: 1_000_000n,
          cacheRead: 0n,
          cacheWrite: 0n,
          reasoningOutput: 0n,
        },
      },
      policy,
    );
    const expected = BigInt(Math.round(bp.outputUsdPerMillion * 1_000_000_000));
    assert.equal(
      res.knownUsdNano,
      expected,
      `${model} output: expected ${expected}`,
    );
  }
});

test("OFFICIAL_PRICES parity: deepseek/minimax/glm-5 reproduce", () => {
  const cases: Array<[string, number]> = [
    ["deepseek-v4-pro", 0.435],
    ["minimax-m2-5", 0.3],
    ["minimax-m2-7-highspeed", 0.6],
    ["glm-5", 1],
  ];
  for (const [model, usdPerMillion] of cases) {
    const res = resolvePrice(registry, inputOnly(model), policy);
    const expected = BigInt(Math.round(usdPerMillion * 1_000_000_000));
    assert.equal(res.confidence, "exact", `${model}: expected exact`);
    assert.equal(res.knownUsdNano, expected, `${model}: expected ${expected}`);
  }
});

test("deepseek free cache-write (rate 0) is billed as zero, not unknown", () => {
  // deepseek-v4-pro has cacheWrite "0" (free), so cache-write tokens are billable at 0.
  const res = resolvePrice(
    registry,
    {
      ...inputOnly("deepseek-v4-pro"),
      tokens: {
        input: 0n,
        output: 0n,
        cacheRead: 0n,
        cacheWrite: 1_000_000n,
        reasoningOutput: 0n,
      },
    },
    policy,
  );
  assert.equal(res.confidence, "exact");
  assert.equal(res.knownUsdNano, 0n);
});

test("approved diff: glm-5.2 (was LiteLLM dynamic 1.4) is now unpriced offline", () => {
  // Removing the LiteLLM authoritative path means dynamically-priced models
  // that were never curated into a pack become unpriced (docs §9). glm-5.2 only
  // had a LiteLLM seed price; the pack has glm-5 (exact), not glm-5.2.
  const res = resolvePrice(registry, inputOnly("glm-5.2"), policy);
  assert.equal(res.confidence, "unpriced");
});
