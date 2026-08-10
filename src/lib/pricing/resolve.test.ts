import assert from "node:assert/strict";
import test from "node:test";

import type {
  BillingRoute,
  PricingLookupInput,
  PricingPack,
  RouteSelectionRule,
} from "./contracts.ts";
import {
  compilePricingRegistry,
  type CompiledPricingRegistry,
} from "./compile.ts";
import { resolvePrice, selectRoute } from "./resolve.ts";
import {
  PRICING_PACKS,
  PRICING_REGISTRY_VERSION,
} from "./pricing-definitions.generated.ts";

const registry = compilePricingRegistry(
  PRICING_PACKS,
  PRICING_REGISTRY_VERSION,
);

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

// ---------------------------------------------------------------------------
// Route selection (F1-T6 route-first)
// ---------------------------------------------------------------------------

test("evidence endpoint selects the route and prices exact", () => {
  const res = resolvePrice(
    registry,
    {
      ...lookup("gpt-5.6-sol", {
        input: 1_000_000n,
        output: 1_000_000n,
        cacheRead: 1_000_000n,
      }),
      evidence: { endpoint: "https://api.openai.com/v1" },
    },
    {},
  );
  assert.equal(res.confidence, "exact");
  assert.equal(res.reason, "exact-match");
  assert.equal(res.billingRouteId, "official-openai");
  assert.equal(res.knownUsdNano, 35_500_000_000n); // 35.5 USD
  assert.equal(res.canonicalModelId, "gpt-5.6-sol");
});

test("deepseek endpoint evidence -> official-deepseek route (contains fallback)", () => {
  const res = resolvePrice(
    registry,
    {
      ...lookup("deepseek-v4-pro", { input: 1_000_000n }),
      evidence: { endpoint: "https://api.deepseek.com/v1" },
    },
    {},
  );
  assert.equal(res.confidence, "exact");
  assert.equal(res.billingRouteId, "official-deepseek");
  assert.equal(res.reason, "exact-match");
});

test("no route evidence -> reference-route estimated, never exact (P1-1)", () => {
  const res = resolvePrice(
    registry,
    lookup("gpt-5.6-sol", {
      input: 1_000_000n,
      output: 1_000_000n,
      cacheRead: 1_000_000n,
    }),
    {},
  );
  assert.equal(res.confidence, "estimated");
  assert.equal(res.reason, "no-route-evidence");
  assert.equal(res.billingRouteId, "official-openai");
  // Reference price reproduces the official amount, but is clearly estimated.
  assert.equal(res.knownUsdNano, 35_500_000_000n);
});

test("route-selection rules win over the contains fallback (synthetic rules)", () => {
  const rule: RouteSelectionRule = {
    id: "sel-enterprise",
    priority: 500,
    when: { kind: "evidence", field: "endpoint", contains: "gateway.internal" },
    routeId: "official-openai",
  };
  const withRules: CompiledPricingRegistry = {
    ...registry,
    routeSelectionRules: [rule],
  };
  // Endpoint contains BOTH the route provider and the selection-rule needle:
  // the rule must win (evidence "api.openai.com/gateway.internal").
  const res = resolvePrice(
    registry,
    {
      ...lookup("gpt-5.6-sol", { input: 1_000_000n }),
      evidence: { endpoint: "https://gateway.internal/openai" },
    },
    {},
  );
  assert.equal(res.confidence, "exact");
  assert.equal(res.billingRouteId, "official-openai");
  assert.equal(res.routeSelectionRuleId, undefined);
  // The rule carries the decision when present in the registry.
  const res2 = resolvePrice(
    withRules,
    {
      ...lookup("gpt-5.6-sol", { input: 1_000_000n }),
      evidence: { endpoint: "https://gateway.internal/openai" },
    },
    {},
  );
  assert.equal(res2.confidence, "exact");
  assert.equal(res2.routeSelectionRuleId, "sel-enterprise");
});

test("selectRoute: equals/contains/present restricted matching, no evidence -> null", () => {
  const withRules: CompiledPricingRegistry = {
    ...registry,
    routeSelectionRules: [
      {
        id: "eq",
        priority: 100,
        when: { kind: "evidence", field: "accountPlan", equals: "enterprise" },
        routeId: "official-openai",
      },
      {
        id: "present",
        priority: 50,
        when: { kind: "evidence", field: "provider", present: true },
        routeId: "official-anthropic",
      },
    ],
  };
  assert.equal(selectRoute(registry, undefined), null);
  assert.deepEqual(selectRoute(withRules, { accountPlan: "enterprise" }), {
    routeId: "official-openai",
    routeSelectionRuleId: "eq",
  });
  assert.deepEqual(selectRoute(withRules, { provider: "anthropic" }), {
    routeId: "official-anthropic",
    routeSelectionRuleId: "present",
  });
  // No rule matches -> contains fallback over billingRoutes.
  assert.deepEqual(
    selectRoute(withRules, { endpoint: "https://api.deepseek.com" }),
    { routeId: "official-deepseek" },
  );
  // Ambiguous (two routes' providers both contained) -> null (no evidence).
  assert.equal(
    selectRoute(registry, {
      endpoint: "https://api.openai.com/anthropic-proxy",
    }),
    null,
  );
});

// ---------------------------------------------------------------------------
// Route isolation: the same model priced differently per route (synthetic)
// ---------------------------------------------------------------------------

const standardProfiles: PricingPack["fallbackProfiles"] = [
  {
    id: "api-generic-v1",
    appliesTo: "api-metered",
    usdNanoPerMillion: {
      input: "1000000000",
      output: "3000000000",
      cacheRead: "100000000",
      cacheWrite: "1250000000",
    },
    confidence: "estimated",
    label: "generic estimate",
  },
  {
    id: "unpriced-v1",
    appliesTo: "unknown",
    confidence: "unpriced",
    label: "unpriced",
  },
];

const dualRoutePacks: PricingPack[] = [
  {
    schemaVersion: 1,
    packId: "dual-a",
    revision: "2026-08-06",
    fallbackProfiles: standardProfiles,
    rules: [
      {
        id: "dual-a-rule",
        scope: { billingRouteIds: ["route-a"] },
        priority: 200,
        when: { kind: "exact", value: "shared-model" },
        convertTo: "shared-model",
        rateRef: "rate-a",
      },
    ],
    rates: [
      {
        id: "rate-a",
        canonicalModelId: "shared-model",
        billingRouteId: "route-a",
        effective: { from: "2026-07-01", to: null },
        usdNanoPerMillion: {
          input: "1000000000",
          output: "1000000000",
          cacheRead: "100000000",
          cacheWrite: null,
        },
        source: { kind: "official", label: "A", verifiedAt: "2026-07-01" },
      },
    ],
  },
  {
    schemaVersion: 1,
    packId: "dual-b",
    revision: "2026-08-06",
    rules: [
      {
        id: "dual-b-rule",
        scope: { billingRouteIds: ["route-b"] },
        priority: 200,
        when: { kind: "exact", value: "shared-model" },
        convertTo: "shared-model",
        rateRef: "rate-b",
      },
    ],
    rates: [
      {
        id: "rate-b",
        canonicalModelId: "shared-model",
        billingRouteId: "route-b",
        effective: { from: "2026-07-01", to: null },
        usdNanoPerMillion: {
          input: "9000000000",
          output: "9000000000",
          cacheRead: "900000000",
          cacheWrite: null,
        },
        source: { kind: "vendor", label: "B", verifiedAt: "2026-07-01" },
      },
    ],
  },
];

const dualRoutes: BillingRoute[] = [
  {
    id: "route-a",
    kind: "official-api",
    provider: "provider-a",
    endpointEvidence: ["endpoint"],
    status: "active",
    reference: true,
  },
  {
    id: "route-b",
    kind: "aggregator",
    provider: "provider-b",
    endpointEvidence: ["endpoint"],
    status: "active",
    reference: true,
  },
];

const dualRegistry: CompiledPricingRegistry = {
  ...compilePricingRegistry(dualRoutePacks, "dual-1"),
  billingRoutes: new Map(dualRoutes.map((r) => [r.id, r] as const)),
};

test("route isolation: same model, different evidence -> different rate (exact)", () => {
  const viaA = resolvePrice(
    dualRegistry,
    {
      ...lookup("shared-model", { input: 1_000_000n }),
      evidence: { endpoint: "https://provider-a.example.com" },
    },
    {},
  );
  assert.equal(viaA.confidence, "exact");
  assert.equal(viaA.billingRouteId, "route-a");
  assert.equal(viaA.knownUsdNano, 1_000_000_000n);

  const viaB = resolvePrice(
    dualRegistry,
    {
      ...lookup("shared-model", { input: 1_000_000n }),
      evidence: { endpoint: "https://provider-b.example.com" },
    },
    {},
  );
  assert.equal(viaB.confidence, "exact");
  assert.equal(viaB.billingRouteId, "route-b");
  assert.equal(viaB.knownUsdNano, 9_000_000_000n);
});

test("dual-route model without evidence -> reference fallback (never a random pick)", () => {
  const res = resolvePrice(
    dualRegistry,
    lookup("shared-model", { input: 1_000_000n }),
    {},
  );
  // Both rules are route-scoped (route-a / route-b) and no route evidence
  // exists: the resolver must not pick a route or a rate. It degrades to the
  // packaged fallback profile (estimated generic), not either route's price.
  assert.equal(res.confidence, "estimated");
  assert.equal(res.reason, "no-rate-match");
  assert.equal(res.billingRouteId, undefined);
  assert.equal(res.knownUsdNano, 1_000_000_000n); // generic input $1/MTok
});

test("non-reference routes never price without evidence", () => {
  const reg: CompiledPricingRegistry = {
    ...dualRegistry,
    billingRoutes: new Map([
      ["route-a", { ...dualRoutes[0]!, reference: false }],
      ["route-b", { ...dualRoutes[1]!, reference: false }],
    ]),
  };
  const res = resolvePrice(reg, lookup("shared-model", { input: 1_000_000n }), {
    fallbackProfileId: "unpriced-v1",
  });
  assert.equal(res.confidence, "unpriced");
  assert.equal(res.reason, "no-rate-match");
  assert.equal(res.knownUsdNano, undefined);
});

// ---------------------------------------------------------------------------
// Matching parity on the built-in registry (no evidence -> reference estimated)
// ---------------------------------------------------------------------------

test("prefix match: snapshot variant gpt-5.6-sol-20260727 resolves via prefix rule", () => {
  const res = resolvePrice(
    registry,
    lookup("gpt-5.6-sol-20260727", { input: 1_000_000n, output: 1_000_000n }),
    {},
  );
  assert.equal(res.confidence, "estimated");
  assert.equal(res.reason, "no-route-evidence");
  assert.equal(res.canonicalModelId, "gpt-5.6-sol");
  assert.equal(res.knownUsdNano, 35_000_000_000n);
});

test("case/dot insensitivity: GPT-5.6.SOL normalizes and matches", () => {
  const res = resolvePrice(
    registry,
    lookup("GPT-5.6.SOL", { input: 1_000_000n, output: 1_000_000n }),
    {},
  );
  assert.equal(res.confidence, "estimated");
  assert.equal(res.knownUsdNano, 5_000_000_000n + 30_000_000_000n);
});

test("unknown model -> estimated via the packaged generic profile (no env gate)", () => {
  // P1-1: api-generic-v1 is "estimated" in fallback-profiles.json, so unknown
  // models estimate by default - never a silent $0, and never env-gated.
  const res = resolvePrice(
    registry,
    lookup("some-unknown-model", { input: 1_000_000n }),
    {},
  );
  assert.equal(res.confidence, "estimated");
  assert.equal(res.reason, "no-rate-match");
  assert.equal(res.fallbackProfileId, "api-generic-v1");
  assert.equal(res.knownUsdNano, 1_000_000_000n); // generic input $1/MTok
});

test("unknown model with explicit unpriced profile stays unpriced", () => {
  const res = resolvePrice(
    registry,
    lookup("some-unknown-model", {}, "codex"),
    { fallbackProfileId: "unpriced-v1" },
  );
  assert.equal(res.confidence, "unpriced");
  assert.equal(res.reason, "no-rate-match");
  assert.equal(res.knownUsdNano, undefined);
});

test("unsafe model name -> unpriced (never matched against garbage)", () => {
  const res = resolvePrice(registry, lookup("bad\u0000model"), {});
  assert.equal(res.confidence, "unpriced");
  assert.equal(res.reason, "unsafe-model");
});

test("notBillable tool -> not-billable", () => {
  const res = resolvePrice(
    registry,
    lookup("gpt-5.6-sol", { input: 1_000_000n }),
    { notBillable: true },
  );
  assert.equal(res.confidence, "not-billable");
  assert.equal(res.reason, "no-policy");
});

test("subscription profile -> not-billable", () => {
  const res = resolvePrice(
    registry,
    lookup("anything", { input: 1_000_000n }),
    { fallbackProfileId: "subscription-zero-marginal-v1" },
  );
  assert.equal(res.confidence, "not-billable");
  assert.equal(res.fallbackProfileId, "subscription-zero-marginal-v1");
});

test("Doubao tiered: 200k input lands on open tier (parity with baseline at USD@7.2)", () => {
  const res = resolvePrice(
    registry,
    lookup("doubao-seed-2-0-code", { input: 200_000n, output: 1_000_000n }),
    {},
  );
  assert.equal(res.confidence, "estimated");
  // tier3: 0.2MTok * (9.6/7.2) + 1MTok * (48/7.2) = 0.2666... + 6.6666... = 6.9333... USD
  assert.equal(res.knownUsdNano, 6_933_333_333n);
  assert.equal(res.rateRuleId, "volcengine/doubao-seed-2-0-code/2026-07-27");
});

test("cacheWrite tokens with null cacheWrite rate -> fallback estimate", () => {
  // gpt-5.6-sol has cacheWrite: null; an event with cache-write tokens cannot
  // be priced exactly -> the packaged fallback applies (estimated generic).
  const res = resolvePrice(
    registry,
    lookup("gpt-5.6-sol", { input: 1n, cacheWrite: 1_000_000n }),
    {},
  );
  assert.equal(res.confidence, "estimated");
  assert.equal(res.reason, "no-rate-match");
  assert.equal(res.fallbackProfileId, "api-generic-v1");
});

test("cacheWrite tokens with known cacheWrite rate (claude-opus-4) are billed", () => {
  const res = resolvePrice(
    registry,
    lookup("claude-opus-4", { input: 1_000_000n, cacheWrite: 1_000_000n }),
    {},
  );
  assert.equal(res.confidence, "estimated");
  // 15 (in) + 18.75 (cacheWrite) USD per million (output is 0)
  assert.equal(res.knownUsdNano, 15_000_000_000n + 18_750_000_000n);
});

test("reasoning billed at output rate only when NOT included in output", () => {
  const both = resolvePrice(
    registry,
    lookup("gpt-5.6-sol", {
      input: 1_000_000n,
      output: 1_000_000n,
      reasoningOutput: 1_000_000n,
    }),
    { reasoningIncludedInOutput: false },
  );
  // 5 (in) + 30 (out) + 30 (reasoning@out) USD
  assert.equal(
    both.knownUsdNano,
    5_000_000_000n + 30_000_000_000n + 30_000_000_000n,
  );
  // Default (reasoningIncludedInOutput true, pre-migration parity): no double bill.
  const included = resolvePrice(
    registry,
    lookup("gpt-5.6-sol", {
      input: 1_000_000n,
      output: 1_000_000n,
      reasoningOutput: 1_000_000n,
    }),
    {},
  );
  assert.equal(included.knownUsdNano, 35_000_000_000n);
});

test("minimax-m2-7-highspeed matches exactly (parity with OFFICIAL_PRICES)", () => {
  const res = resolvePrice(
    registry,
    lookup("MiniMax-M2.7-highspeed", { input: 1_000_000n, output: 1_000_000n }),
    {},
  );
  assert.equal(res.confidence, "estimated");
  assert.equal(res.billingRouteId, "official-minimax");
  // 0.6 (in) + 2.4 (out) USD
  assert.equal(res.knownUsdNano, 600_000_000n + 2_400_000_000n);
});

test("deepseek free cache-write (rate 0) is billed as zero, not unknown", () => {
  const res = resolvePrice(
    registry,
    {
      ...lookup("deepseek-v4-pro"),
      tokens: {
        input: 0n,
        output: 0n,
        cacheRead: 0n,
        cacheWrite: 1_000_000n,
        reasoningOutput: 0n,
      },
    },
    {},
  );
  assert.equal(res.confidence, "estimated");
  assert.equal(res.knownUsdNano, 0n);
});

test("source-aware: toolId filtering excludes tool-scoped rules for other tools", () => {
  const res = resolvePrice(
    registry,
    lookup("gpt-5.6-sol", { input: 1_000_000n }, "claude-code"),
    {},
  );
  assert.equal(res.confidence, "estimated");
});

test("provider-scoped rules require the tool provider (providers participate)", () => {
  const reg = compilePricingRegistry(
    [
      {
        schemaVersion: 1 as const,
        packId: "prov",
        revision: "2026-08-06",
        fallbackProfiles: standardProfiles,
        rules: [
          {
            id: "prov-rule",
            scope: { providers: ["openai"] },
            priority: 200,
            when: { kind: "exact", value: "gpt-5.6-sol" },
            convertTo: "gpt-5.6-sol",
            rateRef: "prov-rate",
          },
        ],
        rates: [
          {
            id: "prov-rate",
            canonicalModelId: "gpt-5.6-sol",
            billingRouteId: "official-openai",
            effective: { from: "2026-07-01", to: null },
            usdNanoPerMillion: {
              input: "1000000000",
              output: "1000000000",
              cacheRead: "100000000",
              cacheWrite: null,
            },
            source: { kind: "official", label: "P", verifiedAt: "2026-07-01" },
          },
        ],
      },
    ],
    "prov-1",
  );
  const withProvider = resolvePrice(
    reg,
    {
      ...lookup("gpt-5.6-sol", { input: 1_000_000n }),
      evidence: { endpoint: "https://api.openai.com" },
    },
    { toolProvider: "openai" },
  );
  assert.equal(withProvider.confidence, "exact");
  const withoutProvider = resolvePrice(
    reg,
    {
      ...lookup("gpt-5.6-sol", { input: 1_000_000n }),
      evidence: { endpoint: "https://api.openai.com" },
    },
    {},
  );
  // Provider unknown -> the provider-scoped rule cannot apply.
  assert.equal(withoutProvider.confidence, "estimated");
  assert.equal(withoutProvider.fallbackProfileId, "api-generic-v1");
});
