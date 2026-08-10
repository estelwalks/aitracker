import assert from "node:assert/strict";
import test from "node:test";

import { buildToolOverview } from "./tool-overview.ts";
import type {
  DashboardUsageEvent,
  DashboardV2Tool,
} from "../../dashboard/contracts.ts";

const input: {
  readonly tools: readonly DashboardV2Tool[];
  readonly events: readonly DashboardUsageEvent[];
} = {
  tools: [
    { id: "codex", name: "Codex CLI", available: true, detected: true },
    { id: "cursor", name: "Cursor", available: true, detected: false },
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
        textResponse: true,
        tools: [{ name: "exec", category: "execution", calls: 2 }],
        skills: [],
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
    view.cards.some((card) => card.id === "cursor"),
    false,
  );
  assert.equal(view.models[0]?.key, "gpt-test");
  assert.equal(view.projects[0]?.key, "trusttools");
});

test("skill evidence distinguishes observed zero from absent context evidence", () => {
  const observed = buildToolOverview(
    input,
    "codex",
    "today",
    "2026-08-10",
    "2026-08-10",
  );
  assert.deepEqual(observed.skillUsage, { observed: true, calls: 0 });

  const absent = buildToolOverview(
    { ...input, events: [input.events[1]] },
    "codex",
    "today",
    "2026-08-10",
    "2026-08-10",
  );
  assert.deepEqual(absent.skillUsage, { observed: false, calls: 0 });
});
