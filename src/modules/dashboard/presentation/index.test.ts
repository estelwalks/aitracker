import assert from "node:assert/strict";
import test from "node:test";
import type { LocalUsageEvent } from "../../../lib/local-usage/types.ts";
import { buildDashboardPosterData } from "./index.ts";

const format = {
  formatDate: (date: Date) => date.toISOString().slice(0, 10),
  formatTokens: (value: number) => String(value),
  formatUsd: (value: number) => `$${value.toFixed(2)}`,
} as never;

function event(overrides: Partial<LocalUsageEvent> = {}): LocalUsageEvent {
  return {
    source: "codex",
    timestamp: "2026-08-07T10:00:00.000Z",
    model: "unknown-model",
    project: "demo",
    inputTokens: 100,
    cachedInputTokens: 20,
    cacheCreationInputTokens: 0,
    outputTokens: 50,
    reasoningOutputTokens: 0,
    totalTokens: 150,
    ...overrides,
  };
}

test("dashboard poster preserves token/cost totals and unknown pricing state", () => {
  const result = buildDashboardPosterData({
    events: [event()],
    totals: {
      events: 1,
      inputTokens: 100,
      cachedInputTokens: 20,
      cacheCreationInputTokens: 0,
      outputTokens: 50,
      reasoningOutputTokens: 0,
      totalTokens: 150,
    },
    cost: {
      knownUsd: 0,
      estimatedUsd: 0,
      cacheSavingsUsd: 0,
      pricedEvents: 0,
      estimatedEvents: 0,
      unknownEvents: 1,
      unknownModels: ["unknown-model"],
      complete: false,
    },
    period: "7d",
    periodLabel: "最近 7 天",
    from: "2026-08-01",
    to: "2026-08-07",
    format,
  });

  assert.equal(result.tokens, 150);
  assert.equal(result.costLabel, "$0.00");
  assert.equal(result.unknownPriceModels, 1);
  assert.equal(result.hitRate, (20 / 120) * 100);
  assert.deepEqual(result.trend, [150]);
  assert.equal(result.models[0]?.name, "unknown-model");
});
