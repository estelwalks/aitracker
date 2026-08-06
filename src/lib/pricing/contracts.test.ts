import assert from "node:assert/strict";
import test from "node:test";

import {
  ConversionRuleSchema,
  FallbackProfileSchema,
  NanoUsdPerMillion,
  PricingPackSchema,
  RateRuleSchema,
  ToolPricingPolicySchema,
  parseNanoUsd,
  usdPerMillionToNano,
} from "./contracts";

const validRate = {
  id: "openai/gpt-5.6-sol/2026-07-27",
  canonicalModelId: "gpt-5.6-sol",
  effective: { from: "2026-07-27", to: null },
  usdNanoPerMillion: {
    input: "5000000000",
    output: "30000000000",
    cacheRead: "500000000",
    cacheWrite: null,
  },
  source: {
    kind: "official",
    label: "OpenAI API pricing",
    url: "https://platform.openai.com/pricing",
    verifiedAt: "2026-07-27",
  },
};

test("RateRule accepts a valid rate with null cacheWrite", () => {
  const parsed = RateRuleSchema.safeParse(validRate);
  assert.equal(parsed.success, true);
});

test("RateRule rejects an invalid date", () => {
  const parsed = RateRuleSchema.safeParse({
    ...validRate,
    effective: { from: "2026/07/27", to: null },
  });
  assert.equal(parsed.success, false);
});

test("RateRule rejects a non-integer nanoUSD string", () => {
  const parsed = RateRuleSchema.safeParse({
    ...validRate,
    usdNanoPerMillion: {
      ...validRate.usdNanoPerMillion,
      input: "5.5",
    },
  });
  assert.equal(parsed.success, false);
});

test("NanoUsdPerMillion rejects negative and decimal amounts", () => {
  assert.equal(
    NanoUsdPerMillion.safeParse({
      input: "-1",
      output: "1",
      cacheRead: "1",
      cacheWrite: null,
    }).success,
    false,
  );
  assert.equal(
    NanoUsdPerMillion.safeParse({
      input: "1.0",
      output: "1",
      cacheRead: "1",
      cacheWrite: null,
    }).success,
    false,
  );
  // zero is a valid non-negative integer string
  assert.equal(
    NanoUsdPerMillion.safeParse({
      input: "0",
      output: "1",
      cacheRead: "1",
      cacheWrite: null,
    }).success,
    true,
  );
});

test("ConversionRule rejects an unknown matcher kind (no regex/substring)", () => {
  const base = {
    id: "r1",
    scope: { toolIds: ["codex"] },
    priority: 200,
    when: { kind: "exact", value: "gpt-5.6-sol" },
    convertTo: "gpt-5.6-sol",
    rateRef: "openai/gpt-5.6-sol/2026-07-27",
  };
  assert.equal(ConversionRuleSchema.safeParse(base).success, true);
  // regex/substring matchers are not in the schema
  assert.equal(
    ConversionRuleSchema.safeParse({
      ...base,
      when: { kind: "regex", value: "gpt-5.*" },
    }).success,
    false,
  );
});

test("FallbackProfile accepts unpriced/not-billable without rates", () => {
  assert.equal(
    FallbackProfileSchema.safeParse({
      id: "unpriced-v1",
      appliesTo: "unknown",
      confidence: "unpriced",
      label: "未配置费率，等待运营补充",
    }).success,
    true,
  );
  assert.equal(
    FallbackProfileSchema.safeParse({
      id: "subscription-zero-marginal-v1",
      appliesTo: "subscription",
      confidence: "not-billable",
      label: "订阅制用量，不按 API 单价估算",
    }).success,
    true,
  );
});

test("PricingPack parses with defaults for empty rules/rates", () => {
  const parsed = PricingPackSchema.parse({
    schemaVersion: 1,
    packId: "openai",
    revision: "2026-08-05",
  });
  assert.deepEqual(parsed.rules, []);
  assert.deepEqual(parsed.rates, []);
});

test("ToolPricingPolicy defaults reasoningPolicy to ignore", () => {
  const parsed = ToolPricingPolicySchema.parse({
    billingMode: "api-metered",
    fallbackProfileRef: "unpriced-v1",
  });
  assert.equal(parsed.reasoningPolicy, "ignore");
  assert.deepEqual(parsed.rulePackRefs, []);
});

test("parseNanoUsd and usdPerMillionToNano convert correctly", () => {
  assert.equal(parseNanoUsd("5000000000"), 5_000_000_000n);
  // $5/MTok = 5e9 nanoUSD
  assert.equal(usdPerMillionToNano(5), 5_000_000_000n);
  assert.equal(usdPerMillionToNano(0.5), 500_000_000n);
});
