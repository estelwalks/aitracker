import assert from "node:assert/strict";
import test from "node:test";

import type { PricingPack } from "./contracts.ts";
import { compilePricingRegistry, compileIsValid } from "./compile.ts";
import {
  PRICING_PACKS,
  PRICING_REGISTRY_VERSION,
} from "./pricing-definitions.generated.ts";

test("real built-in rule packs compile with no errors", () => {
  const registry = compilePricingRegistry(
    PRICING_PACKS,
    PRICING_REGISTRY_VERSION,
  );
  const errors = registry.diagnostics.filter((d) => d.severity === "error");
  assert.equal(errors.length, 0, errors.map((e) => e.message).join("; "));
  assert.equal(registry.version, PRICING_REGISTRY_VERSION);
  // 17 rates, 3 profiles, 29 rules.
  assert.equal(registry.rates.size, 17);
  assert.equal(registry.profiles.size, 3);
  assert.equal(registry.rules.length, 29);
});

test("duplicate rate id is an error", () => {
  const rate = {
    id: "dup/rate/2026-01-01",
    canonicalModelId: "dup",
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
