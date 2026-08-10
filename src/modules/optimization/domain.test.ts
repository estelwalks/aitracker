import assert from "node:assert/strict";
import test from "node:test";
import { buildOptimizationSnapshot } from "./domain.ts";
import type { OptimizationInput } from "./contracts.ts";

function project(overrides: Record<string, unknown> = {}) {
  return {
    id: "project:alpha",
    displayName: "Alpha",
    projectRef: null,
    known: true,
    tokens: {
      inputTokens: 8_000,
      cachedInputTokens: 500,
      cacheCreationInputTokens: 0,
      outputTokens: 1_000,
      reasoningOutputTokens: 0,
      totalTokens: 9_500,
    },
    cost: {
      knownUsd: 12,
      estimatedUsd: 0,
      cacheSavingsUsd: 0,
      pricedEvents: 2,
      estimatedEvents: 0,
      unknownEvents: 0,
      unknownModels: [],
      complete: true,
    },
    eventCount: 2,
    sessionCount: 1,
    ...overrides,
  };
}

function input(overrides: Partial<OptimizationInput> = {}): OptimizationInput {
  return {
    observedAt: "2026-08-07T00:00:00.000Z",
    projects: {
      generatedAt: "2026-08-07T00:00:00.000Z",
      projects: [project()],
      unknownProjectId: "project:unknown",
    },
    ...overrides,
  } as OptimizationInput;
}

test("emits explainable high-cost and cache findings with deterministic ordering", () => {
  const snapshot = buildOptimizationSnapshot(input());
  assert.deepEqual(
    snapshot.findings.map((item) => item.code),
    ["high-cost", "low-cache-hit-rate"],
  );
  assert.deepEqual(snapshot.findings[0]?.estimatedImpact, {
    kind: "cost",
    confidence: "exact",
    amountUsd: 12,
    unit: "usd",
  });
  assert.equal(
    snapshot.findings[0]?.recommendation?.evidenceRef,
    snapshot.findings[0]?.evidenceRef,
  );
});

test("labels estimated costs without presenting them as exact", () => {
  const result = buildOptimizationSnapshot(
    input({
      projects: {
        generatedAt: "2026-08-07T00:00:00.000Z",
        projects: [
          project({
            cost: {
              knownUsd: 0,
              estimatedUsd: 15,
              cacheSavingsUsd: 0,
              pricedEvents: 0,
              estimatedEvents: 2,
              unknownEvents: 0,
              unknownModels: [],
              complete: false,
            },
          }),
        ],
        unknownProjectId: "project:unknown",
      },
    }),
  );
  assert.equal(
    result.findings.find((item) => item.code === "high-cost")?.estimatedImpact
      ?.confidence,
    "estimated",
  );
  assert.equal(
    result.findings.find((item) => item.code === "high-cost")?.estimatedImpact
      ?.amountUsd,
    15,
  );
});

test("does not invent a dollar amount for unknown pricing", () => {
  const result = buildOptimizationSnapshot(
    input({
      projects: {
        generatedAt: "2026-08-07T00:00:00.000Z",
        projects: [
          project({
            cost: {
              knownUsd: 0,
              estimatedUsd: 0,
              cacheSavingsUsd: 0,
              pricedEvents: 0,
              estimatedEvents: 0,
              unknownEvents: 2,
              unknownModels: ["opaque-model"],
              complete: false,
            },
          }),
        ],
        unknownProjectId: "project:unknown",
      },
    }),
  );
  const finding = result.findings.find((item) => item.code === "unknown-price");
  assert.equal(finding?.estimatedImpact?.confidence, "unknown");
  assert.equal(
    Object.hasOwn(finding?.estimatedImpact ?? {}, "amountUsd"),
    false,
  );
});

test("supports duplicate and unidentified-project diagnostics", () => {
  const result = buildOptimizationSnapshot(
    input({
      duplicateConfigurations: [{ key: "provider:model", count: 2 }],
      projects: {
        generatedAt: "2026-08-07T00:00:00.000Z",
        projects: [
          project({
            id: "project:unknown",
            displayName: "Unknown project",
            known: false,
            eventCount: 4,
            tokens: {
              inputTokens: 0,
              cachedInputTokens: 0,
              cacheCreationInputTokens: 0,
              outputTokens: 0,
              reasoningOutputTokens: 0,
              totalTokens: 0,
            },
            cost: {
              knownUsd: 0,
              estimatedUsd: 0,
              cacheSavingsUsd: 0,
              pricedEvents: 0,
              estimatedEvents: 0,
              unknownEvents: 0,
              unknownModels: [],
              complete: true,
            },
          }),
        ],
        unknownProjectId: "project:unknown",
      },
    }),
  );
  assert.deepEqual(
    result.findings.map((item) => item.code),
    ["duplicate-configuration", "project-anomaly"],
  );
});

test("returns empty output for empty data and never leaks sensitive values", () => {
  const result = buildOptimizationSnapshot({
    observedAt: "2026-08-07T00:00:00.000Z",
  });
  assert.deepEqual(result.findings, []);
  assert.doesNotMatch(
    JSON.stringify(
      buildOptimizationSnapshot(
        input({
          duplicateConfigurations: [
            { key: "/Users/alice/.config/token=secret", count: 2 },
          ],
        }),
      ),
    ),
    /Users|secret|token=/i,
  );
});
