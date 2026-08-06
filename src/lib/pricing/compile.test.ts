import assert from "node:assert/strict";
import test from "node:test";

import type {
  ModelAliasRule,
  ModelMatcher,
  PricingPack,
  RateRule,
  Scope,
} from "./contracts.ts";
import {
  compileIsValid,
  compilePricingRegistry,
  matchersIntersect,
} from "./compile.ts";
import {
  PRICING_PACKS,
  PRICING_REGISTRY_VERSION,
} from "./pricing-definitions.generated.ts";

function makeRate(
  id: string,
  opts: {
    model?: string;
    route?: string;
    region?: string;
    from?: string;
    to?: string | null;
  } = {},
): RateRule {
  return {
    id,
    canonicalModelId: opts.model ?? "m",
    billingRouteId: opts.route ?? "route/1",
    ...(opts.region !== undefined ? { region: opts.region } : {}),
    effective: { from: opts.from ?? "2026-01-01", to: opts.to ?? null },
    usdNanoPerMillion: {
      input: "1",
      output: "2",
      cacheRead: "1",
      cacheWrite: null,
    },
    source: { kind: "official", label: "x", verifiedAt: "2026-01-01" },
  };
}

function makeRule(
  id: string,
  when: ModelMatcher,
  opts: {
    scope?: Scope;
    priority?: number;
    convertTo?: string;
    rateRef?: string;
    fallbackProfileRef?: string;
  } = {},
): ModelAliasRule {
  return {
    id,
    scope: opts.scope ?? {},
    priority: opts.priority ?? 100,
    when,
    ...(opts.convertTo !== undefined ? { convertTo: opts.convertTo } : {}),
    ...(opts.rateRef !== undefined ? { rateRef: opts.rateRef } : {}),
    ...(opts.fallbackProfileRef !== undefined
      ? { fallbackProfileRef: opts.fallbackProfileRef }
      : {}),
  };
}

function makePack(
  rates: RateRule[],
  rules: ModelAliasRule[],
  extra: Partial<PricingPack> = {},
): PricingPack {
  return {
    schemaVersion: 1,
    packId: "p",
    revision: "1",
    rates,
    rules,
    ...extra,
  };
}

function errorsOf(registry: ReturnType<typeof compilePricingRegistry>) {
  return registry.diagnostics.filter((d) => d.severity === "error");
}

test("real built-in rule packs compile with no errors", () => {
  const registry = compilePricingRegistry(
    PRICING_PACKS,
    PRICING_REGISTRY_VERSION,
  );
  const errors = errorsOf(registry);
  assert.equal(errors.length, 0, errors.map((e) => e.message).join("; "));
  assert.equal(registry.version, PRICING_REGISTRY_VERSION);
  // 17 rates, 3 profiles, 29 rules.
  assert.equal(registry.rates.size, 17);
  assert.equal(registry.profiles.size, 3);
  assert.equal(registry.rules.length, 29);
  // P1-1 route dimension: 7 billing routes, 17 catalog models, no selection rules.
  assert.equal(registry.billingRoutes.size, 7);
  assert.equal(registry.routeSelectionRules.length, 0);
  assert.equal(registry.modelCatalog.size, 17);
  assert.ok(registry.billingRoutes.has("official-openai"));
  assert.ok(registry.modelCatalog.has("gpt-5.6-sol"));
});

test("duplicate rate id is an error", () => {
  const rate = {
    id: "dup/rate/2026-01-01",
    canonicalModelId: "dup",
    billingRouteId: "route/1",
    effective: { from: "2026-01-01", to: null },
    usdNanoPerMillion: {
      input: "1",
      output: "2",
      cacheRead: "1",
      cacheWrite: null,
    },
    source: { kind: "official" as const, label: "x", verifiedAt: "2026-01-01" },
  };
  const pack: PricingPack = {
    schemaVersion: 1,
    packId: "dup",
    revision: "1",
    rates: [rate, { ...rate }],
    rules: [],
  };
  const registry = compilePricingRegistry([pack], "v");
  assert.equal(compileIsValid(registry), false);
  assert.ok(registry.diagnostics.some((d) => d.code === "duplicate-rate-id"));
});

test("unresolved rateRef is an error", () => {
  const pack: PricingPack = {
    schemaVersion: 1,
    packId: "bad",
    revision: "1",
    rates: [],
    rules: [
      {
        id: "r1",
        scope: {},
        priority: 100,
        when: { kind: "exact", value: "m" },
        convertTo: "m",
        rateRef: "does/not-exist",
      },
    ],
  };
  const registry = compilePricingRegistry([pack], "v");
  assert.equal(compileIsValid(registry), false);
  assert.ok(registry.diagnostics.some((d) => d.code === "unresolved-rate-ref"));
});

test("two rates for the same canonical model on overlapping dates is an error", () => {
  const base = {
    canonicalModelId: "shared",
    billingRouteId: "route/1",
    usdNanoPerMillion: {
      input: "1",
      output: "2",
      cacheRead: "1",
      cacheWrite: null,
    },
    source: { kind: "official" as const, label: "x", verifiedAt: "2026-01-01" },
  };
  const pack: PricingPack = {
    schemaVersion: 1,
    packId: "overlap",
    revision: "1",
    rates: [
      { ...base, id: "a", effective: { from: "2026-01-01", to: null } },
      { ...base, id: "b", effective: { from: "2026-06-01", to: null } },
    ],
    rules: [],
  };
  const registry = compilePricingRegistry([pack], "v");
  assert.equal(compileIsValid(registry), false);
  assert.ok(registry.diagnostics.some((d) => d.code === "overlapping-rates"));
});

test("same matcher+scope+priority+interval rules is an overlap error", () => {
  const rate = {
    id: "rate/1",
    canonicalModelId: "m",
    billingRouteId: "route/1",
    effective: { from: "2026-01-01", to: null },
    usdNanoPerMillion: {
      input: "1",
      output: "2",
      cacheRead: "1",
      cacheWrite: null,
    },
    source: { kind: "official" as const, label: "x", verifiedAt: "2026-01-01" },
  };
  const pack: PricingPack = {
    schemaVersion: 1,
    packId: "p",
    revision: "1",
    rates: [rate],
    rules: [
      {
        id: "r1",
        scope: {},
        priority: 100,
        when: { kind: "exact", value: "m" },
        convertTo: "m",
        rateRef: "rate/1",
      },
      {
        id: "r2",
        scope: {},
        priority: 100,
        when: { kind: "exact", value: "m" },
        convertTo: "m",
        rateRef: "rate/1",
      },
    ],
  };
  const registry = compilePricingRegistry([pack], "v");
  assert.equal(compileIsValid(registry), false);
  assert.ok(registry.diagnostics.some((d) => d.code === "rule-overlap"));
});

test("exact ranks above prefix in the sorted index", () => {
  const rate = {
    id: "rate/1",
    canonicalModelId: "m",
    billingRouteId: "route/1",
    effective: { from: "2026-01-01", to: null },
    usdNanoPerMillion: {
      input: "1",
      output: "2",
      cacheRead: "1",
      cacheWrite: null,
    },
    source: { kind: "official" as const, label: "x", verifiedAt: "2026-01-01" },
  };
  const pack: PricingPack = {
    schemaVersion: 1,
    packId: "p",
    revision: "1",
    rates: [rate],
    rules: [
      {
        id: "prefix-rule",
        scope: {},
        priority: 120,
        when: { kind: "prefix", value: "m" },
        convertTo: "m",
        rateRef: "rate/1",
      },
      {
        id: "exact-rule",
        scope: {},
        priority: 200,
        when: { kind: "exact", value: "m" },
        convertTo: "m",
        rateRef: "rate/1",
      },
    ],
  };
  const registry = compilePricingRegistry([pack], "v");
  // exact (precision 60) sorts before prefix (precision 40) regardless of input order.
  assert.equal(registry.rules[0]!.id, "exact-rule");
  assert.equal(registry.rules[1]!.id, "prefix-rule");
});

test("tool-scoped rule ranks above global rule", () => {
  const rate = {
    id: "rate/1",
    canonicalModelId: "m",
    billingRouteId: "route/1",
    effective: { from: "2026-01-01", to: null },
    usdNanoPerMillion: {
      input: "1",
      output: "2",
      cacheRead: "1",
      cacheWrite: null,
    },
    source: { kind: "official" as const, label: "x", verifiedAt: "2026-01-01" },
  };
  const pack: PricingPack = {
    schemaVersion: 1,
    packId: "p",
    revision: "1",
    rates: [rate],
    rules: [
      {
        id: "global-rule",
        scope: {},
        priority: 200,
        when: { kind: "exact", value: "m" },
        convertTo: "m",
        rateRef: "rate/1",
      },
      {
        id: "tool-rule",
        scope: { toolIds: ["codex"] },
        priority: 200,
        when: { kind: "exact", value: "m" },
        convertTo: "m",
        rateRef: "rate/1",
      },
    ],
  };
  const registry = compilePricingRegistry([pack], "v");
  assert.equal(registry.rules[0]!.id, "tool-rule");
  assert.equal(registry.rules[1]!.id, "global-rule");
});

test("unreferenced rate and profile produce warnings", () => {
  const pack: PricingPack = {
    schemaVersion: 1,
    packId: "p",
    revision: "1",
    rates: [
      {
        id: "unused-rate",
        canonicalModelId: "m",
        billingRouteId: "route/1",
        effective: { from: "2026-01-01", to: null },
        usdNanoPerMillion: {
          input: "1",
          output: "2",
          cacheRead: "1",
          cacheWrite: null,
        },
        source: { kind: "official", label: "x", verifiedAt: "2026-01-01" },
      },
    ],
    fallbackProfiles: [
      {
        id: "unused-profile",
        appliesTo: "unknown",
        confidence: "unpriced",
        label: "x",
      },
    ],
    rules: [],
  };
  const registry = compilePricingRegistry([pack], "v");
  assert.equal(compileIsValid(registry), true); // warnings, not errors
  assert.ok(registry.diagnostics.some((d) => d.code === "unreferenced-rate"));
  assert.ok(
    registry.diagnostics.some((d) => d.code === "unreferenced-profile"),
  );
});

// ---------------------------------------------------------------------------
// P1-2: matcher intersection ambiguity fixtures
// ---------------------------------------------------------------------------

test("two intersecting token-sequence rules in the same route/model/region/priority/interval are ambiguous", () => {
  const registry = compilePricingRegistry(
    [
      makePack(
        [makeRate("rate/1")],
        [
          makeRule(
            "ts1",
            { kind: "token-sequence", tokens: ["gpt", "5"] },
            { convertTo: "m", rateRef: "rate/1" },
          ),
          makeRule(
            "ts2",
            { kind: "token-sequence", tokens: ["gpt", "5", "sol"] },
            { convertTo: "m", rateRef: "rate/1" },
          ),
        ],
      ),
    ],
    "v",
  );
  assert.equal(compileIsValid(registry), false);
  assert.ok(registry.diagnostics.some((d) => d.code === "rule-overlap"));
});

test("two same-layer intersecting prefixes (gpt-5 vs gpt-5-6) are ambiguous", () => {
  const registry = compilePricingRegistry(
    [
      makePack(
        [makeRate("rate/1")],
        [
          makeRule(
            "p1",
            { kind: "prefix", value: "gpt-5" },
            { convertTo: "m", rateRef: "rate/1" },
          ),
          makeRule(
            "p2",
            { kind: "prefix", value: "gpt-5-6" },
            { convertTo: "m", rateRef: "rate/1" },
          ),
        ],
      ),
    ],
    "v",
  );
  assert.equal(compileIsValid(registry), false);
  assert.ok(registry.diagnostics.some((d) => d.code === "rule-overlap"));
});

test("disjoint same-layer exacts plus an intersecting prefix layer compile cleanly", () => {
  const registry = compilePricingRegistry(
    [
      makePack(
        [makeRate("rate/1")],
        [
          // Same-layer exacts with different values: disjoint match sets.
          makeRule(
            "exact-5",
            { kind: "exact", value: "gpt-5" },
            { priority: 200, convertTo: "m", rateRef: "rate/1" },
          ),
          makeRule(
            "exact-5-6",
            { kind: "exact", value: "gpt-5-6" },
            { priority: 200, convertTo: "m", rateRef: "rate/1" },
          ),
          // Prefix layer intersects both exacts but ranks below them (precision).
          makeRule(
            "prefix-5-6",
            { kind: "prefix", value: "gpt-5-6" },
            { priority: 120, convertTo: "m", rateRef: "rate/1" },
          ),
        ],
      ),
    ],
    "v",
  );
  const errors = errorsOf(registry);
  assert.equal(errors.length, 0, errors.map((e) => e.message).join("; "));
});

test("same matcher on different billing routes is not ambiguous (route isolation)", () => {
  const registry = compilePricingRegistry(
    [
      makePack(
        [
          makeRate("rate/a", { route: "route/a" }),
          makeRate("rate/b", { route: "route/b" }),
        ],
        [
          makeRule(
            "ra",
            { kind: "exact", value: "m" },
            { convertTo: "m", rateRef: "rate/a" },
          ),
          makeRule(
            "rb",
            { kind: "exact", value: "m" },
            { convertTo: "m", rateRef: "rate/b" },
          ),
        ],
      ),
    ],
    "v",
  );
  const errors = errorsOf(registry);
  assert.equal(errors.length, 0, errors.map((e) => e.message).join("; "));
  assert.ok(!registry.diagnostics.some((d) => d.code === "overlapping-rates"));
});

test("same model/matcher in different regions is not ambiguous (region isolation)", () => {
  const registry = compilePricingRegistry(
    [
      makePack(
        [
          makeRate("rate/a", { region: "global" }),
          makeRate("rate/b", { region: "eu-west" }),
        ],
        [
          makeRule(
            "ra",
            { kind: "exact", value: "m" },
            { convertTo: "m", rateRef: "rate/a" },
          ),
          makeRule(
            "rb",
            { kind: "exact", value: "m" },
            { convertTo: "m", rateRef: "rate/b" },
          ),
        ],
      ),
    ],
    "v",
  );
  const errors = errorsOf(registry);
  assert.equal(errors.length, 0, errors.map((e) => e.message).join("; "));
  assert.ok(!registry.diagnostics.some((d) => d.code === "overlapping-rates"));
});

test("same matcher with non-overlapping effective intervals is legal (historical segmentation)", () => {
  const registry = compilePricingRegistry(
    [
      makePack(
        [
          makeRate("rate/a", { from: "2026-01-01", to: "2026-06-30" }),
          makeRate("rate/b", { from: "2026-07-01", to: null }),
        ],
        [
          makeRule(
            "ra",
            { kind: "exact", value: "m" },
            { convertTo: "m", rateRef: "rate/a" },
          ),
          makeRule(
            "rb",
            { kind: "exact", value: "m" },
            { convertTo: "m", rateRef: "rate/b" },
          ),
        ],
      ),
    ],
    "v",
  );
  const errors = errorsOf(registry);
  assert.equal(errors.length, 0, errors.map((e) => e.message).join("; "));
  assert.ok(!registry.diagnostics.some((d) => d.code === "overlapping-rates"));
});

test("two same-layer `any` rules are ambiguous", () => {
  const registry = compilePricingRegistry(
    [
      makePack(
        [],
        [
          makeRule("any1", { kind: "any" }, { fallbackProfileRef: "fp" }),
          makeRule("any2", { kind: "any" }, { fallbackProfileRef: "fp" }),
        ],
        {
          fallbackProfiles: [
            {
              id: "fp",
              appliesTo: "api-metered",
              confidence: "estimated",
              label: "x",
            },
          ],
        },
      ),
    ],
    "v",
  );
  assert.equal(compileIsValid(registry), false);
  assert.ok(registry.diagnostics.some((d) => d.code === "rule-overlap"));
});

test("intersecting prefixes at different priorities are not ambiguous (priority domain)", () => {
  const registry = compilePricingRegistry(
    [
      makePack(
        [makeRate("rate/1")],
        [
          makeRule(
            "p1",
            { kind: "prefix", value: "gpt-5" },
            { priority: 120, convertTo: "m", rateRef: "rate/1" },
          ),
          makeRule(
            "p2",
            { kind: "prefix", value: "gpt-5-6" },
            { priority: 100, convertTo: "m", rateRef: "rate/1" },
          ),
        ],
      ),
    ],
    "v",
  );
  const errors = errorsOf(registry);
  assert.equal(errors.length, 0, errors.map((e) => e.message).join("; "));
});

// ---------------------------------------------------------------------------
// P1-2: matcher intersection decision table (unit level)
// ---------------------------------------------------------------------------

test("matcher intersection decision table (P1-2)", () => {
  const exact = (value: string) => ({ kind: "exact" as const, value });
  const alias = (value: string) => ({ kind: "alias" as const, value });
  const prefix = (value: string) => ({ kind: "prefix" as const, value });
  const suffix = (value: string) => ({ kind: "suffix" as const, value });
  const tokenSeq = (tokens: string[]) => ({
    kind: "token-sequence" as const,
    tokens,
  });
  const any = () => ({ kind: "any" as const });

  // any intersects everything.
  assert.equal(matchersIntersect(any(), exact("a")), true);
  assert.equal(matchersIntersect(exact("a"), any()), true);
  assert.equal(matchersIntersect(any(), any()), true);

  // exact/alias vs exact/alias: intersect iff values are equal.
  assert.equal(matchersIntersect(exact("a"), exact("a")), true);
  assert.equal(matchersIntersect(exact("a"), exact("b")), false);
  assert.equal(matchersIntersect(exact("a"), alias("a")), true);
  assert.equal(matchersIntersect(alias("a"), alias("b")), false);

  // exact vs prefix: value equals the prefix or starts with `prefix-`.
  assert.equal(matchersIntersect(exact("gpt-5"), prefix("gpt-5")), true);
  assert.equal(matchersIntersect(exact("gpt-5-6"), prefix("gpt-5")), true);
  assert.equal(matchersIntersect(exact("gpt-5x"), prefix("gpt-5")), false);

  // exact vs suffix: value equals the suffix or ends with `-suffix`.
  assert.equal(matchersIntersect(exact("gpt-5"), suffix("5")), true);
  assert.equal(matchersIntersect(exact("gpt-5"), suffix("6")), false);

  // exact vs token-sequence: tokens form an ordered subsequence of the value.
  assert.equal(
    matchersIntersect(exact("gpt-5-sol"), tokenSeq(["gpt", "sol"])),
    true,
  );
  assert.equal(
    matchersIntersect(exact("gpt-5-sol"), tokenSeq(["sol", "gpt"])),
    false,
  );

  // prefix vs prefix: segment-boundary prefix relationship.
  assert.equal(matchersIntersect(prefix("gpt-5"), prefix("gpt-5")), true);
  assert.equal(matchersIntersect(prefix("gpt-5"), prefix("gpt-5-6")), true);
  assert.equal(matchersIntersect(prefix("gpt-5-6"), prefix("gpt-5")), true);
  assert.equal(matchersIntersect(prefix("gpt-5"), prefix("gpt-5x")), false);

  // suffix vs suffix: segment-boundary suffix relationship.
  assert.equal(matchersIntersect(suffix("5"), suffix("5")), true);
  assert.equal(matchersIntersect(suffix("5"), suffix("sol-5")), true);
  assert.equal(matchersIntersect(suffix("5"), suffix("6")), false);

  // prefix vs suffix always intersect (`p-s` is a witness).
  assert.equal(matchersIntersect(prefix("gpt"), suffix("6")), true);

  // prefix/token-sequence and suffix/token-sequence always intersect.
  assert.equal(matchersIntersect(prefix("gpt"), tokenSeq(["claude"])), true);
  assert.equal(matchersIntersect(suffix("6"), tokenSeq(["claude"])), true);

  // token-sequence vs token-sequence always intersect (concatenation witness).
  assert.equal(
    matchersIntersect(tokenSeq(["gpt", "5"]), tokenSeq(["claude", "opus"])),
    true,
  );
  assert.equal(
    matchersIntersect(tokenSeq(["a", "b"]), tokenSeq(["b", "a"])),
    true,
  );
});
