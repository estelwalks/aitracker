import assert from "node:assert/strict";
import test from "node:test";

import {
  BillingRouteSchema,
  ConversionRuleSchema,
  FallbackProfileSchema,
  ModelCatalogEntrySchema,
  ModelAliasRuleSchema,
  NanoUsdPerMillion,
  PricingManifestSchema,
  PricingPackSchema,
  RateRuleSchema,
  RouteSelectionRuleSchema,
  ToolModelObservationSchema,
  ToolPricingPolicySchema,
  parseNanoUsd,
  usdPerMillionToNano,
} from "./contracts";

const validRate = {
  id: "openai/gpt-5.6-sol/2026-07-27",
  canonicalModelId: "gpt-5.6-sol",
  // P1-1: rates are owned by billing routes (primary key includes route+region).
  billingRouteId: "official-openai",
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

// --- P1-1 pricing-ownership contracts -------------------------------------

test("RateRule requires a billingRouteId (P1-1 primary key)", () => {
  const { billingRouteId: _omit, ...withoutRoute } = validRate;
  assert.equal(RateRuleSchema.safeParse(withoutRoute).success, false);
  assert.equal(RateRuleSchema.safeParse(validRate).success, true);
});

test("RateRule region defaults to absent (= global), accepts explicit region", () => {
  const parsed = RateRuleSchema.parse({
    ...validRate,
    region: "cn-north-1",
  });
  assert.equal(parsed.region, "cn-north-1");
  assert.equal(RateRuleSchema.parse(validRate).region, undefined);
});

test("BillingRoute accepts an official-api route with evidence + region", () => {
  assert.equal(
    BillingRouteSchema.safeParse({
      id: "official-openai",
      name: "OpenAI official API",
      kind: "official-api",
      provider: "openai",
      endpointEvidence: ["endpoint", "baseUrl"],
      region: { default: "global", fromEvidence: ["region"] },
    }).success,
    true,
  );
  // retired status defaults to active when omitted.
  assert.equal(
    BillingRouteSchema.parse({
      id: "r",
      kind: "aggregator",
    }).status,
    "active",
  );
});

test("RouteSelectionRule allows only restricted matching (equals/contains/present)", () => {
  const base = { id: "r1", priority: 100, routeId: "official-deepseek" };
  assert.equal(
    RouteSelectionRuleSchema.safeParse({
      ...base,
      when: { kind: "evidence", field: "endpoint", contains: "deepseek.com" },
    }).success,
    true,
  );
  assert.equal(
    RouteSelectionRuleSchema.safeParse({
      ...base,
      when: { kind: "evidence", field: "endpoint" },
    }).success,
    false,
    "at least one of equals/contains/present is required",
  );
  assert.equal(
    RouteSelectionRuleSchema.safeParse({
      ...base,
      when: { kind: "evidence", field: "endpoint", equals: "x", contains: "y" },
    }).success,
    false,
    "equals and contains are mutually exclusive",
  );
  assert.equal(
    RouteSelectionRuleSchema.safeParse({
      ...base,
      when: { kind: "regex", field: "endpoint", value: ".*" },
    }).success,
    false,
    "regex matching is forbidden",
  );
});

test("ModelCatalogEntry declares a canonical id with provider/alias profile", () => {
  assert.equal(
    ModelCatalogEntrySchema.safeParse({
      id: "gpt-5.6-sol",
      provider: "openai",
      aliases: { profile: "generic-normalize-v1" },
    }).success,
    true,
  );
});

test("ModelAliasRule is the conversion-rule evolution with billingRouteIds scope", () => {
  const base = {
    id: "r1",
    priority: 200,
    when: { kind: "exact", value: "deepseek-v4-pro" },
    convertTo: "deepseek-v4-pro",
    rateRef: "deepseek/deepseek-v4-pro/2026-07-27",
  };
  assert.equal(
    ModelAliasRuleSchema.safeParse({
      ...base,
      scope: { billingRouteIds: ["official-deepseek"] },
    }).success,
    true,
  );
  // Deprecated alias still parses the same rule shape.
  assert.equal(
    ConversionRuleSchema.safeParse({
      ...base,
      scope: { toolIds: ["codex"] },
    }).success,
    true,
  );
});

test("ToolModelObservation declares evidence extraction, never rates", () => {
  const parsed = ToolModelObservationSchema.parse({
    modelField: "model",
    normalizeProfile: "generic-normalize-v1",
    evidence: { endpointField: "endpoint", providerField: "provider" },
    tokenSemantics: { reasoningIncludedInOutput: true },
  });
  assert.equal(parsed.evidence?.endpointField, "endpoint");
  assert.equal(parsed.tokenSemantics?.reasoningIncludedInOutput, true);
});

test("PricingManifest accepts the P1-1 data-file entries", () => {
  const parsed = PricingManifestSchema.parse({
    schemaVersion: 1,
    packs: [
      { packId: "defaults", path: "src/lib/pricing/rules/defaults.rules.json" },
    ],
    modelCatalog: { path: "src/lib/pricing/rules/model-catalog.json" },
    billingRoutes: { path: "src/lib/pricing/rules/billing-routes.json" },
    modelAliasRules: { path: "src/lib/pricing/rules/model-alias-rules.json" },
    routeSelectionRules: {
      path: "src/lib/pricing/rules/route-selection-rules.json",
    },
    ratePacks: [
      {
        packId: "official-routes",
        path: "src/lib/pricing/rules/rate-packs/official.routes.json",
      },
    ],
    fallbackProfiles: { path: "src/lib/pricing/rules/fallback-profiles.json" },
  });
  assert.equal(parsed.ratePacks?.length, 1);
  // A manifest without the new entries still parses (backward compatible).
  assert.equal(
    PricingManifestSchema.parse({
      schemaVersion: 1,
      packs: [],
    }).modelCatalog,
    undefined,
  );
});
