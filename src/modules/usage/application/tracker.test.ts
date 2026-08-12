import assert from "node:assert/strict";
import test from "node:test";

import type { LocalUsageEvent } from "../../../lib/local-usage/types.ts";
import {
  aggregateBoards,
  buildBoard,
  computeMoM,
  suggestionFor,
  wasteIndex,
} from "./tracker.ts";

function event(
  overrides: Partial<LocalUsageEvent> & { timestamp: string },
): LocalUsageEvent {
  return {
    source: "claude-code",
    model: "claude-opus-4",
    project: "project-a",
    inputTokens: 100,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    outputTokens: 50,
    reasoningOutputTokens: 0,
    totalTokens: 150,
    ...overrides,
  };
}

test("wasteIndex: full cache reuse scores zero, no cache + all output scores 100", () => {
  assert.equal(wasteIndex(100, 1), 0);
  assert.equal(wasteIndex(0, 1), 100);
  assert.equal(wasteIndex(null, 1), 100);
  assert.equal(wasteIndex(50, 0.5), 25);
  // clamped
  assert.equal(wasteIndex(0, 2), 100);
  assert.equal(wasteIndex(0, -1), 0);
});

test("computeMoM: null when no comparable previous evidence", () => {
  assert.equal(computeMoM(100, null), null);
  assert.equal(computeMoM(100, 0), null);
  assert.equal(computeMoM(100, 100), "flat");
  assert.equal(computeMoM(120, 100), "up");
  assert.equal(computeMoM(80, 100), "down");
  // small drift within threshold stays flat
  assert.equal(computeMoM(103, 100), "flat");
});

test("suggestionFor: cache, output, volume then none", () => {
  assert.equal(
    suggestionFor({ cacheRate: 20, outputRatio: 0.5, tokens: 10_000 }),
    "cache",
  );
  assert.equal(
    suggestionFor({ cacheRate: 60, outputRatio: 0.8, tokens: 10_000 }),
    "output",
  );
  assert.equal(
    suggestionFor({ cacheRate: 60, outputRatio: 0.2, tokens: 500_000 }),
    "volume",
  );
  assert.equal(
    suggestionFor({ cacheRate: 70, outputRatio: 0.2, tokens: 1_000 }),
    "none",
  );
});

test("buildBoard: project dimension aggregates one row per project", () => {
  const events = [
    event({
      timestamp: "2026-08-01T00:00:00Z",
      project: "a",
      outputTokens: 50,
      totalTokens: 150,
    }),
    event({
      timestamp: "2026-08-02T00:00:00Z",
      project: "a",
      outputTokens: 10,
      totalTokens: 110,
    }),
    event({
      timestamp: "2026-08-03T00:00:00Z",
      project: "b",
      outputTokens: 200,
      totalTokens: 400,
    }),
  ];
  const board = buildBoard(events, "project");
  assert.equal(board.rows.length, 2);
  const a = board.rows.find((row) => row.name === "a");
  assert.ok(a);
  assert.equal(a.events, 2);
  assert.equal(a.tokens, 260);
  assert.equal(a.cacheRate, 0);
  assert.equal(a.outputRatio, 60 / 260);
});

test("buildBoard: session dimension skips events without a session id", () => {
  const events = [
    event({ timestamp: "2026-08-01T00:00:00Z", sessionId: "s1" }),
    event({ timestamp: "2026-08-02T00:00:00Z" }),
  ];
  const board = buildBoard(events, "session");
  assert.equal(board.rows.length, 1);
  assert.equal(board.rows[0]?.name, "s1");
});

test("buildBoard: skill dimension attributes tokens by skill-call share", () => {
  const events = [
    event({
      timestamp: "2026-08-01T00:00:00Z",
      totalTokens: 300,
      outputTokens: 100,
      context: {
        skills: [
          { name: "git-helper", calls: 2 },
          { name: "reviewer", calls: 1 },
        ],
      },
    }),
  ];
  const board = buildBoard(events, "skill");
  assert.equal(board.rows.length, 2);
  const git = board.rows.find((row) => row.name === "git-helper");
  const review = board.rows.find((row) => row.name === "reviewer");
  assert.ok(git && review);
  assert.equal(git.tokens, 200);
  assert.equal(review.tokens, 100);
  assert.equal(git.calls, 2);
  assert.equal(review.calls, 1);
});

test("buildBoard: rows sort by waste index descending", () => {
  const events = [
    event({
      timestamp: "2026-08-01T00:00:00Z",
      project: "no-cache",
      outputTokens: 500,
      totalTokens: 500,
      cachedInputTokens: 0,
    }),
    event({
      timestamp: "2026-08-01T00:00:00Z",
      project: "cached",
      outputTokens: 10,
      totalTokens: 100,
      cachedInputTokens: 1000,
      inputTokens: 0,
    }),
  ];
  const board = buildBoard(events, "project");
  assert.equal(board.rows[0]?.name, "no-cache");
});

test("aggregateBoards: sums unique entries, tokens and events", () => {
  const { rows } = buildBoard(
    [event({ timestamp: "2026-08-01T00:00:00Z", project: "a" })],
    "project",
  );
  const totals = aggregateBoards([{ rows }]);
  assert.equal(totals.tokens, 150);
  assert.equal(totals.events, 1);
  assert.equal(totals.entries, 1);
});
