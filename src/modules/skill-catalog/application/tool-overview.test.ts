import assert from "node:assert/strict";
import test from "node:test";

import { buildToolOverview } from "./tool-overview.ts";
import type { DashboardV2Snapshot } from "../../dashboard/contracts.ts";

const input: DashboardV2Snapshot = {
  generatedAt: "2026-08-10T12:00:00.000Z",
  mode: "real",
  pricingAvailable: false,
  skills: { available: true, count: 2, generatedAt: null },
  sessions: {
    available: true,
    generatedAt: null,
    byProjectDay: [
      {
        source: "codex",
        project: "trusttools",
        date: "2026-08-10",
        count: 2,
      },
    ],
    bySourceDay: [{ source: "codex", date: "2026-08-10", count: 2 }],
  },
  tools: [
    { id: "codex", name: "Codex CLI", available: true, detected: true },
    { id: "cursor", name: "Cursor", available: true, detected: false },
    { id: "other", name: "Other", available: false, detected: false },
  ],
  events: [
    {
      source: "codex",
      timestamp: "2026-08-10T10:00:00.000Z",
      model: "gpt-test",
      project: "trusttools",
      inputTokens: 80,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      outputTokens: 20,
      reasoningOutputTokens: 0,
      totalTokens: 100,
      context: {
        textResponses: 1,
        toolCalls: 2,
        skillCalls: 0,
        toolOutputCalls: 0,
      },
    },
    {
      source: "codex",
      timestamp: "2026-08-10T11:00:00.000Z",
      model: "gpt-test",
      project: "trusttools",
      inputTokens: 40,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      outputTokens: 10,
      reasoningOutputTokens: 0,
      totalTokens: 50,
      context: {
        textResponses: 1,
        toolCalls: 0,
        skillCalls: 0,
        toolOutputCalls: 0,
      },
    },
  ],
};

test("tool overview uses scan state plus real sanitized event aggregates", () => {
  const view = buildToolOverview(
    input,
    "codex",
    "today",
    "2026-08-10",
    "2026-08-10",
  );
  assert.equal(view.cards[0]?.id, "codex");
  assert.equal(view.cards[0]?.tokens, 150);
  assert.equal(view.cards[0]?.events, 2);
  assert.equal(
    view.cards.find((card) => card.id === "cursor")?.state,
    "available",
  );
  assert.equal(
    view.cards.find((card) => card.id === "other")?.state,
    "unavailable",
  );
  assert.equal(view.cards.find((card) => card.id === "codex")?.sessions, 2);
  assert.equal(view.cards.find((card) => card.id === "codex")?.cacheRate, 0);
  assert.equal(view.projects[0]?.sessions, 2);
  assert.equal(view.models[0]?.key, "gpt-test");
  assert.equal(view.projects[0]?.key, "trusttools");
});

test("skill evidence preserves observed zero and unavailable sessions", () => {
  const observed = buildToolOverview(
    input,
    "codex",
    "today",
    "2026-08-10",
    "2026-08-10",
  );
  assert.deepEqual(observed.skillUsage, { observed: true, calls: 0 });

  const absent = buildToolOverview(
    { ...input, sessions: { ...input.sessions, available: false } },
    "codex",
    "all",
    "2026-08-10",
    "2026-08-10",
  );
  assert.equal(absent.sessions, null);
  assert.equal(absent.projects[0]?.sessions, null);
});

test("tool overview selection and all details use the same custom range", () => {
  const view = buildToolOverview(
    {
      ...input,
      events: [
        ...input.events,
        {
          ...input.events[0]!,
          source: "cursor",
          timestamp: "2026-08-09T10:00:00.000Z",
          project: "outside-range",
          totalTokens: 900,
        },
      ],
      sessions: {
        ...input.sessions,
        bySourceDay: [
          ...input.sessions.bySourceDay,
          { source: "cursor", date: "2026-08-09", count: 9 },
        ],
      },
    },
    "missing-tool",
    "custom",
    "2026-08-10",
    "2026-08-10",
  );

  assert.equal(view.selected?.id, "codex");
  assert.equal(view.totalTokens, 150);
  assert.equal(view.totalEvents, 2);
  assert.deepEqual(view.trend, [{ date: "2026-08-10", tokens: 150 }]);
  assert.equal(view.models[0]?.key, "gpt-test");
  assert.equal(view.projects[0]?.key, "trusttools");
  assert.equal(view.sessions, 2);
  assert.equal(
    view.cards.find((card) => card.id === "cursor")?.state,
    "available",
  );
});

test("tool overview stays within renderer-safe aggregate fields", () => {
  const view = buildToolOverview(
    input,
    "codex",
    "today",
    "2026-08-10",
    "2026-08-10",
  );
  const serialized = JSON.stringify(view);
  assert.equal(serialized.includes("sessionId"), false);
  assert.equal(serialized.includes("/Users/"), false);
  assert.equal(serialized.includes("raw context"), false);
});
