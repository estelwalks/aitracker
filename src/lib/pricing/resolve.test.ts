import assert from "node:assert/strict";
import test from "node:test";

import type { PricingLookupInput, ToolPricingPolicy } from "./contracts.ts";
import { compilePricingRegistry } from "./compile.ts";
import { resolvePrice } from "./resolve.ts";
import {
  PRICING_PACKS,
  PRICING_REGISTRY_VERSION,
} from "./pricing-definitions.generated.ts";

const registry = compilePricingRegistry(
  PRICING_PACKS,
  PRICING_REGISTRY_VERSION,
);

const apiPolicy: ToolPricingPolicy = {
  billingMode: "api-metered",
  rulePackRefs: [],
  fallbackProfileRef: "unpriced-v1",
  reasoningPolicy: "ignore",
};

function lookup(
  model: string,
  tokens: Partial<PricingLookupInput["tokens"]> = {},
  toolId = "codex",
  occurredAt = "2026-07-28T10:00:00.000Z",
): PricingLookupInput {
  return {
    toolId,
    rawModel: model,
    occurredAt,
    tokens: {
      input: 0n,
      output: 0n,
      cacheRead: 0n,
      cacheWrite: 0n,
      reasoningOutput: 0n,
      ...tokens,
    },
  };
}

test("exact match: gpt-5.6-sol prices input/output/cacheRead (parity with baseline 35.5 USD)", () => {
  const res = resolvePrice(
    registry,
    lookup("gpt-5.6-sol", {
      input: 1_000_000n,
      output: 1_000_000n,
      cacheRead: 1_000_000n,
    }),
    apiPolicy,
  );
  assert.equal(res.confidence, "exact");
  assert.equal(res.reason, "exact-match");
  assert.equal(res.knownUsdNano, 35_500_000_000n); // 35.5 USD
  assert.equal(res.canonicalModelId, "gpt-5.6-sol");
});

test("prefix match: snapshot variant gpt-5.6-sol-20260727 resolves via prefix rule", () => {
  const res = resolvePrice(
    registry,
    lookup("gpt-5.6-sol-20260727", { input: 1_000_000n, output: 1_000_000n }),
    apiPolicy,
  );
  assert.equal(res.confidence, "exact");
  assert.equal(res.reason, "prefix-match");
  assert.equal(res.canonicalModelId, "gpt-5.6-sol");
});

test("case/dot insensitivity: GPT-5.6.SOL normalizes and matches", () => {
  const res = resolvePrice(
    registry,
    lookup("GPT-5.6.SOL", { input: 1_000_000n, output: 1_000_000n }),
    apiPolicy,
  );
  assert.equal(res.confidence, "exact");
  assert.equal(res.knownUsdNano, 5_000_000_000n + 30_000_000_000n);
});

test("unknown model -> unpriced (never $0)", () => {
  const res = resolvePrice(registry, lookup("some-unknown-model"), apiPolicy);
  assert.equal(res.confidence, "unpriced");
  assert.equal(res.reason, "no-rate-match");
  assert.equal(res.knownUsdNano, undefined);
});

test("billingMode unsupported -> not-billable", () => {
  const policy: ToolPricingPolicy = {
    billingMode: "unsupported",
    rulePackRefs: [],
    fallbackProfileRef: "unpriced-v1",
    reasoningPolicy: "ignore",
  };
  const res = resolvePrice(registry, lookup("gpt-5.6-sol"), policy);
  assert.equal(res.confidence, "not-billable");
});

test("subscription fallback -> not-billable", () => {
  const policy: ToolPricingPolicy = {
    billingMode: "subscription",
    rulePackRefs: [],
    fallbackProfileRef: "subscription-zero-marginal-v1",
    reasoningPolicy: "ignore",
  };
  const res = resolvePrice(registry, lookup("anything"), policy);
  assert.equal(res.confidence, "not-billable");
  assert.equal(res.fallbackProfileId, "subscription-zero-marginal-v1");
});

test("Doubao tiered: 200k input lands on open tier (parity with baseline at USD@7.2)", () => {
  const res = resolvePrice(
    registry,
    lookup("doubao-seed-2-0-code", { input: 200_000n, output: 1_000_000n }),
    apiPolicy,
  );
  assert.equal(res.confidence, "exact");
  // tier3: 0.2MTok * (9.6/7.2) + 1MTok * (48/7.2) = 0.2666... + 6.6666... = 6.9333... USD
  assert.equal(res.knownUsdNano, 6_933_333_333n);
  assert.equal(res.rateRuleId, "volcengine/doubao-seed-2-0-code/2026-07-27");
});

test("cacheWrite tokens with null cacheWrite rate -> fallback unpriced", () => {
  // gpt-5.6-sol has cacheWrite: null; an event with cache-write tokens cannot be priced.
  const res = resolvePrice(
    registry,
    lookup("gpt-5.6-sol", { input: 1n, cacheWrite: 1_000_000n }),
    apiPolicy,
  );
  assert.equal(res.confidence, "unpriced");
  assert.equal(res.reason, "no-rate-match");
});

test("cacheWrite tokens with known cacheWrite rate (claude-opus-4) are billed", () => {
  const res = resolvePrice(
    registry,
    lookup("claude-opus-4", { input: 1_000_000n, cacheWrite: 1_000_000n }),
    apiPolicy,
  );
  assert.equal(res.confidence, "exact");
  // 15 (in) + 18.75 (cacheWrite) USD per million (output is 0)
  assert.equal(res.knownUsdNano, 15_000_000_000n + 18_750_000_000n);
});

test("reasoningPolicy bill-as-output bills reasoning at output rate", () => {
  const policy: ToolPricingPolicy = {
    ...apiPolicy,
    reasoningPolicy: "bill-as-output",
  };
  const res = resolvePrice(
    registry,
    lookup("gpt-5.6-sol", {
      input: 1_000_000n,
      output: 1_000_000n,
      reasoningOutput: 1_000_000n,
    }),
    policy,
  );
  // 5 (in) + 30 (out) + 30 (reasoning@out) USD
  assert.equal(
    res.knownUsdNano,
    5_000_000_000n + 30_000_000_000n + 30_000_000_000n,
  );
});

test("minimax-m2-7-highspeed matches exactly (parity with OFFICIAL_PRICES)", () => {
  const res = resolvePrice(
    registry,
    lookup("MiniMax-M2.7-highspeed", { input: 1_000_000n, output: 1_000_000n }),
    apiPolicy,
  );
  assert.equal(res.confidence, "exact");
  // 0.6 (in) + 2.4 (out) USD
  assert.equal(res.knownUsdNano, 600_000_000n + 2_400_000_000n);
});

test("source-aware: toolId filtering excludes tool-scoped rules for other tools", () => {
  // Built-in OpenAI rules are global, so this asserts the global path still
  // resolves for any tool. Tool-scoped exclusion is covered by compile tests.
  const res = resolvePrice(
    registry,
    lookup("gpt-5.6-sol", { input: 1_000_000n }, "claude-code"),
    apiPolicy,
  );
  assert.equal(res.confidence, "exact");
});
