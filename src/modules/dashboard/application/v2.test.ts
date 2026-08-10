import assert from "node:assert/strict";
import test from "node:test";
import { createDashboardV2View } from "./v2.ts";
import type { DashboardV2Snapshot } from "../contracts.ts";

const snapshot: DashboardV2Snapshot = {
  generatedAt: "2026-08-10T12:00:00.000Z",
  mode: "real",
  pricingAvailable: false,
  skills: { available: true, count: 2, generatedAt: null },
  sessions: {
    available: true,
    generatedAt: null,
    records: [
      {
        startedAt: "2026-08-10T10:00:00.000Z",
        endedAt: "2026-08-10T10:10:00.000Z",
        durationMs: 600_000,
        turns: 2,
        editTurns: 1,
      },
    ],
  },
  tools: [{ id: "codex", name: "Codex CLI", available: true, detected: true }],
  events: [
    {
      source: "codex",
      timestamp: "2026-08-10T10:00:00.000Z",
      model: "gpt-test",
      project: "trusttools_webapp",
      inputTokens: 80,
      cachedInputTokens: 20,
      cacheCreationInputTokens: 0,
      outputTokens: 20,
      reasoningOutputTokens: 0,
      totalTokens: 100,
      context: {
        textResponses: 1,
        toolCalls: 2,
        skillCalls: 1,
        toolOutputCalls: 1,
      },
    },
  ],
};

test("Dashboard V2 uses one period for metrics, trend, cards and context", () => {
  const view = createDashboardV2View(
    snapshot,
    "today",
    "2026-08-10",
    "2026-08-10",
  );

  assert.equal(view.totals.totalTokens, 100);
  assert.equal(view.trend[0]?.tokens, 100);
  assert.equal(view.tools[0]?.tokens, 100);
  assert.equal(view.context.toolCalls, 2);
  assert.equal(view.sessions, 1);
  assert.equal(view.estimatedCostUsd, null);
});

test("Dashboard V2 does not invent unavailable session or pricing values", () => {
  const view = createDashboardV2View(
    {
      ...snapshot,
      pricingAvailable: false,
      sessions: { available: false, generatedAt: null, records: [] },
    },
    "today",
    "2026-08-10",
    "2026-08-10",
  );

  assert.equal(view.sessions, null);
  assert.equal(view.estimatedCostUsd, null);
});
