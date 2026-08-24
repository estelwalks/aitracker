import assert from "node:assert/strict";
import test from "node:test";

import { buildLocalUsageSnapshot } from "../../../lib/local-usage/aggregate.ts";
import type { LocalUsageEvent } from "../../../lib/local-usage/types.ts";
import {
  buildUsageSnapshotFromProjection,
  compactUsageSnapshot,
} from "./aggregate-projection.ts";

function event(
  timestamp: string,
  overrides: Partial<LocalUsageEvent> = {},
): LocalUsageEvent {
  return {
    source: "codex",
    timestamp,
    model: "gpt-test",
    project: "/workspace/project-a",
    inputTokens: 10,
    cachedInputTokens: 2,
    cacheCreationInputTokens: 1,
    outputTokens: 5,
    reasoningOutputTokens: 3,
    totalTokens: 21,
    context: {
      textResponse: true,
      tools: [{ name: "exec_command", category: "execution", calls: 2 }],
      skills: [{ name: "review", calls: 1 }],
      toolOutputs: { characters: 10, lines: 1, completed: true, calls: 2 },
    },
    ...overrides,
  };
}

test("compact projection preserves token, event and dimension aggregates", () => {
  const raw = buildLocalUsageSnapshot(
    [
      event("2026-08-20T12:00:00.000Z"),
      event("2026-08-20T13:00:00.000Z", { totalTokens: 30 }),
      event("2026-08-19T12:00:00.000Z", {
        source: "claude-code",
        model: "claude-test",
        project: "/workspace/project-b",
      }),
    ],
    [],
    new Date("2026-08-20T14:00:00.000Z"),
  );

  const compact = compactUsageSnapshot(raw);
  assert.equal(compact.details.length, 0);
  assert.equal(compact.recent.length, 0);
  assert.equal(compact.aggregateBuckets?.length, 2);
  assert.equal(
    compact.trackerBuckets?.filter((row) => row.dimension === "project").length,
    2,
  );
  assert.equal(
    compact.trackerBuckets?.filter((row) => row.dimension === "skill").length,
    2,
  );
  assert.equal(
    compact.aggregateBuckets?.find((row) => row.source === "codex")?.events,
    2,
  );
  assert.equal(
    compact.aggregateBuckets?.find((row) => row.source === "codex")?.context
      .toolCalls,
    4,
  );

  const rebuilt = buildUsageSnapshotFromProjection({
    generatedAt: compact.generatedAt,
    sources: compact.sources,
    buckets: compact.aggregateBuckets ?? [],
  });
  assert.deepEqual(rebuilt.totals, raw.totals);
  assert.deepEqual(rebuilt.bySource, raw.bySource);
  assert.deepEqual(rebuilt.byModel, raw.byModel);
  assert.deepEqual(rebuilt.byProject, raw.byProject);
  assert.deepEqual(
    rebuilt.daily.map(({ bySource: _bySource, ...row }) => row),
    raw.daily.map(({ bySource: _bySource, ...row }) => row),
  );
  for (const day of raw.daily) {
    for (const [source, counts] of Object.entries(day.bySource)) {
      if (counts.totalTokens === 0) continue;
      assert.deepEqual(
        rebuilt.daily.find((row) => row.date === day.date)?.bySource[source],
        counts,
      );
    }
  }
});

test("already compact snapshots never reintroduce raw details", () => {
  const raw = buildLocalUsageSnapshot(
    [event("2026-08-20T12:00:00.000Z")],
    [],
    new Date("2026-08-20T14:00:00.000Z"),
  );
  const compact = compactUsageSnapshot(raw);
  const poisoned = { ...compact, details: raw.details, recent: raw.recent };
  const normalized = compactUsageSnapshot(poisoned);
  assert.equal(normalized.details.length, 0);
  assert.equal(normalized.recent.length, 0);
  assert.deepEqual(normalized.aggregateBuckets, compact.aggregateBuckets);
  assert.deepEqual(normalized.trackerBuckets, compact.trackerBuckets);
});
