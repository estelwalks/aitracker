import assert from "node:assert/strict";
import test from "node:test";

import { buildLocalUsageSnapshot } from "./aggregate";
import type { LocalUsageEvent } from "./types";

test("快照保留全部明细供真实分页，同时限制最近活动", () => {
  const events: LocalUsageEvent[] = Array.from({ length: 60 }, (_, index) => ({
    source: "codex",
    timestamp: new Date(Date.UTC(2026, 6, 27, 12, index)).toISOString(),
    model: "gpt-5.6-sol",
    project: "~/demo",
    sessionId: index % 2 === 0 ? `session-${index % 3}` : undefined,
    inputTokens: 10,
    cachedInputTokens: 2,
    cacheCreationInputTokens: 0,
    outputTokens: 5,
    reasoningOutputTokens: 1,
    totalTokens: 17,
  }));

  const snapshot = buildLocalUsageSnapshot(events, []);
  assert.equal(snapshot.details.length, 60);
  assert.equal(snapshot.recent.length, 50);
  assert.equal(snapshot.details[0]?.timestamp, events[59]?.timestamp);
  assert.equal(snapshot.details[0]?.sessionId, events[59]?.sessionId);
  assert.equal(snapshot.details[1]?.sessionId, events[58]?.sessionId);
});
