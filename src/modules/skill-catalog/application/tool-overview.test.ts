import assert from "node:assert/strict";
import test from "node:test";

import { buildToolOverview } from "./tool-overview.ts";
import type { DashboardV2Snapshot } from "../../dashboard/contracts.ts";
import { APP_ID } from "../../../lib/app-config.ts";

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
        project: APP_ID,
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
      project: APP_ID,
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
      project: APP_ID,
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
  assert.deepEqual(
    view.cards.map((card) => card.id),
    ["claude-code", "codex"],
  );
  const claude = view.cards[0]!;
  assert.deepEqual(
    {
      state: claude.state,
      tokens: claude.tokens,
      events: claude.events,
      sessions: claude.sessions,
      cacheRate: claude.cacheRate,
      skillUsage: claude.skillUsage,
    },
    {
      state: "unavailable",
      tokens: 0,
      events: 0,
      sessions: 0,
      cacheRate: null,
      skillUsage: { observed: false, calls: 0 },
    },
  );
  assert.equal(view.cards[1]?.tokens, 150);
  assert.equal(view.cards[1]?.events, 2);
  assert.equal(view.cards.find((card) => card.id === "codex")?.sessions, 2);
  assert.equal(view.cards.find((card) => card.id === "codex")?.cacheRate, 0);
  assert.equal(view.cards.find((card) => card.id === "codex")?.messages, 2);
  assert.equal(view.projects[0]?.sessions, 2);
  assert.equal(view.models[0]?.key, "gpt-test");
  assert.equal(view.projects[0]?.key, APP_ID);
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

test("installed Claude with zero events is detected, not an unavailable tool", () => {
  const view = buildToolOverview(
    {
      ...input,
      tools: [
        {
          id: "claude-code",
          name: "Claude Code",
          available: false,
          detected: true,
        },
        ...input.tools,
      ],
    },
    "claude-code",
    "today",
    "2026-08-10",
    "2026-08-10",
  );

  assert.deepEqual(view.selected, {
    id: "claude-code",
    name: "Claude Code",
    available: false,
    detected: true,
    active: false,
    state: "detected",
    tokens: 0,
    events: 0,
    share: 0,
    sessions: 0,
    cacheRate: null,
    messages: null,
    lastActiveAt: null,
    skillUsage: { observed: false, calls: 0 },
  });
});

test("the first active tool is selected when there is no explicit selection", () => {
  const view = buildToolOverview(
    input,
    null,
    "today",
    "2026-08-10",
    "2026-08-10",
  );

  assert.equal(view.selected?.id, "codex");
});

test("detail rows retain real priced cost semantics when pricing is available", () => {
  const view = buildToolOverview(
    { ...input, pricingAvailable: true },
    "codex",
    "today",
    "2026-08-10",
    "2026-08-10",
  );

  assert.equal(typeof view.models[0]?.estimatedCostUsd, "number");
  assert.equal(view.models[0]?.estimatedCostIsPartial, false);
  assert.deepEqual(view.tokenComposition, {
    inputTokens: 120,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    outputTokens: 30,
    reasoningOutputTokens: 0,
  });
});

test("tool card names use the server-projected registry display name", () => {
  const view = buildToolOverview(
    {
      ...input,
      tools: input.tools.map((tool) =>
        tool.id === "codex" ? { ...tool, name: "Configured Codex" } : tool,
      ),
    },
    "codex",
    "today",
    "2026-08-10",
    "2026-08-10",
  );

  assert.equal(view.selected?.name, "Configured Codex");
  assert.equal(
    view.cards.find((card) => card.id === "codex")?.name,
    "Configured Codex",
  );
  assert.equal(
    view.cards.find((card) => card.id === "claude-code")?.name,
    "Claude Code",
  );
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
    "codex",
    "custom",
    "2026-08-10",
    "2026-08-10",
  );

  assert.equal(view.selected?.id, "codex");
  assert.equal(view.totalTokens, 150);
  assert.equal(view.totalEvents, 2);
  assert.deepEqual(view.trend, [{ date: "2026-08-10", tokens: 150 }]);
  assert.equal(view.models[0]?.key, "gpt-test");
  assert.equal(view.projects[0]?.key, APP_ID);
  assert.equal(view.sessions, 2);
  assert.equal(view.cards.length, 2);
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
