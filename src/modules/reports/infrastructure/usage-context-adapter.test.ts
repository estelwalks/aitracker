import assert from "node:assert/strict";
import test from "node:test";

import { BUILTIN_REPORT_DEFINITIONS } from "../domain.ts";
import {
  createReportContextPort,
  type SnapshotSession,
} from "./usage-context-adapter.ts";
import type { UsageSnapshotDto } from "../../usage/contracts.ts";

const daily = BUILTIN_REPORT_DEFINITIONS[0]!;
const weekly = BUILTIN_REPORT_DEFINITIONS[1]!;

/** ISO instant whose LOCAL wall clock is the given date/time (tz-independent). */
const localIso = (year: number, month: number, day: number, hour = 10) =>
  new Date(year, month - 1, day, hour).toISOString();

function session(
  iso: string,
  extra: Partial<SnapshotSession> = {},
): SnapshotSession {
  return {
    source: "claude-code",
    title: "T",
    projectKey: "p1",
    startedAt: iso,
    turns: 5,
    editTurns: 1,
    totals: { totalTokens: 1000 },
    cost: { knownUsd: 0.01 },
    durationMs: 600_000,
    ...extra,
  };
}

function snapshotWith(sessions: readonly SnapshotSession[]) {
  return {
    ensureHydrated: async () => undefined,
    readLatest: () => ({ data: { sessions } }),
  };
}

function usageSnapshotWith(
  data: Pick<UsageSnapshotDto, "daily" | "aggregateBuckets">,
) {
  return {
    ensureHydrated: async () => undefined,
    readLatest: () => ({ data: data as UsageSnapshotDto }),
  };
}

const tokenCounts = (totalTokens: number) => ({
  inputTokens: totalTokens,
  cachedInputTokens: 0,
  cacheCreationInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens,
});

const AUG_SAMPLE = [
  session(localIso(2026, 8, 15, 10)), // local 08-15
  session(localIso(2026, 8, 14, 10)), // local 08-14
  session(localIso(2026, 8, 15, 22)), // local 08-15
  session(localIso(2026, 8, 16, 9)), //  local 08-16
];

test("day period aggregates only that local day", async () => {
  const port = createReportContextPort({ snapshot: snapshotWith(AUG_SAMPLE) });
  const ctx = await port.collect({
    definition: daily,
    period: { granularity: "day", key: "2026-08-15" },
  });
  assert.equal(ctx.stats?.sessions, 2);
  assert.equal(ctx.stats?.tokens, 2000);
  assert.equal(ctx.stats?.costUsd, 0.02);
  assert.deepEqual(
    ctx.evidence.map((item) => item.ref),
    ["usage:2026-08-15"],
  );
});

test("week period covers its Monday–Sunday range", async () => {
  const port = createReportContextPort({ snapshot: snapshotWith(AUG_SAMPLE) });
  const ctx = await port.collect({
    definition: weekly,
    // 2026-08-10 is a Monday; the week covers 08-10..08-16.
    period: { granularity: "week", key: "2026-08-10" },
  });
  assert.equal(ctx.stats?.sessions, 4);
  assert.deepEqual(
    ctx.evidence.map((item) => item.ref),
    ["usage:2026-08-10"],
  );
});

test("month period aggregates the whole month", async () => {
  const port = createReportContextPort({ snapshot: snapshotWith(AUG_SAMPLE) });
  const ctx = await port.collect({
    definition: weekly,
    period: { granularity: "month", key: "2026-08" },
  });
  assert.equal(ctx.stats?.sessions, 4);
  assert.deepEqual(
    ctx.evidence.map((item) => item.ref),
    ["usage:2026-08-01"],
  );
});

test("an empty selected period yields an honest zero-stats context", async () => {
  const port = createReportContextPort({ snapshot: snapshotWith(AUG_SAMPLE) });
  const ctx = await port.collect({
    definition: daily,
    period: { granularity: "day", key: "2026-07-01" },
  });
  assert.equal(ctx.stats?.sessions, 0);
  assert.equal(ctx.stats?.tokens, 0);
  assert.deepEqual(ctx.evidence, []);
});

test("no period falls back to the current local day for daily", async () => {
  const now = new Date();
  const today = session(
    localIso(now.getFullYear(), now.getMonth() + 1, now.getDate(), 12),
  );
  const port = createReportContextPort({ snapshot: snapshotWith([today]) });
  const ctx = await port.collect({ definition: daily });
  assert.equal(ctx.stats?.sessions, 1);
  assert.equal(ctx.stats?.tokens, 1000);
});

test("uses event-day usage for tokens while keeping session metrics", async () => {
  const port = createReportContextPort({
    snapshot: snapshotWith([
      session(localIso(2026, 8, 15), {
        source: "codex",
        totals: { totalTokens: 1000 },
      }),
      session(localIso(2026, 8, 15), {
        source: "unused-agent",
        totals: { totalTokens: 50 },
      }),
      session(localIso(2026, 8, 14), {
        source: "codex",
        totals: { totalTokens: 900 },
      }),
    ]),
    usage: usageSnapshotWith({
      daily: [
        {
          date: "2026-08-15",
          ...tokenCounts(3000),
          events: 3,
          bySource: {
            codex: tokenCounts(2500),
            aipy: tokenCounts(500),
          },
        } as UsageSnapshotDto["daily"][number],
      ],
      aggregateBuckets: [
        {
          date: "2026-08-15",
          latestTimestamp: localIso(2026, 8, 15),
          source: "codex",
          model: "test-model",
          project: "opaque-project",
          projectLabel: "event-project",
          ...tokenCounts(2500),
          measurement: "observed",
          events: 1,
          context: {
            textResponses: 0,
            toolCalls: 1,
            tools: [{ name: "exec", category: "execution", calls: 1 }],
            skillCalls: 0,
            toolOutputCalls: 0,
          },
          evidence: {
            textResponses: false,
            toolCalls: false,
            skillCalls: false,
            toolOutputCalls: false,
            reasoningTokens: false,
            systemPromptTokens: false,
          },
        },
        {
          date: "2026-08-15",
          latestTimestamp: localIso(2026, 8, 15),
          source: "aipy",
          model: "test-model",
          project: "quick-project",
          projectLabel: "quick-project",
          ...tokenCounts(500),
          measurement: "observed",
          events: 1,
          context: {
            textResponses: 0,
            toolCalls: 0,
            tools: [],
            skillCalls: 0,
            toolOutputCalls: 0,
          },
          evidence: {
            textResponses: false,
            toolCalls: false,
            skillCalls: false,
            toolOutputCalls: false,
            reasoningTokens: false,
            systemPromptTokens: false,
          },
        },
      ] as NonNullable<UsageSnapshotDto["aggregateBuckets"]>,
    }),
  });
  const ctx = await port.collect({
    definition: daily,
    period: { granularity: "day", key: "2026-08-15" },
  });

  assert.equal(ctx.stats?.sessions, 2);
  assert.equal(ctx.stats?.turns, 10);
  assert.equal(ctx.stats?.durationMin, 20);
  assert.equal(ctx.stats?.tokens, 3000);
  assert.deepEqual(
    ctx.stats?.bySource.map(({ source, sessions, tokens }) => ({
      source,
      sessions,
      tokens,
    })),
    [
      { source: "codex", sessions: 1, tokens: 2500 },
      { source: "aipy", sessions: 0, tokens: 500 },
    ],
  );
  assert.deepEqual(ctx.stats?.projects, ["event-project", "quick-project"]);
  assert.equal(ctx.stats?.editsComplete, false);
  assert.equal(ctx.stats?.bySource[0]?.editsComplete, false);
  assert.match(ctx.summary, /代码改动数据不完整/);
  assert.match(ctx.summary, /\| codex \| 1 \| 2\.5K \| [^|]+ \| — \|/);
  assert.doesNotMatch(ctx.summary, /unused-agent/);
  assert.match(ctx.summary, /含内部 Agent 调用/);
});

test("prices in-memory aggregate buckets even when project labels are not hydrated", async () => {
  const port = createReportContextPort({
    snapshot: snapshotWith([
      session(localIso(2026, 8, 15), {
        source: "codex",
        totals: { totalTokens: 1000 },
        cost: { knownUsd: 0 },
      }),
    ]),
    usage: usageSnapshotWith({
      daily: [
        {
          date: "2026-08-15",
          ...tokenCounts(1_000_000),
          events: 1,
          bySource: { codex: tokenCounts(1_000_000) },
        } as UsageSnapshotDto["daily"][number],
      ],
      aggregateBuckets: [
        {
          date: "2026-08-15",
          latestTimestamp: localIso(2026, 8, 15),
          source: "codex",
          model: "gpt-5-codex",
          // This is the shape of a fresh in-memory bucket before the
          // persisted project label is resolved by SQLite.
          project: "/Users/demo/project",
          ...tokenCounts(1_000_000),
          measurement: "observed",
          events: 1,
          context: {
            textResponses: 0,
            toolCalls: 0,
            tools: [],
            skillCalls: 0,
            toolOutputCalls: 0,
          },
          evidence: {
            textResponses: false,
            toolCalls: false,
            skillCalls: false,
            toolOutputCalls: false,
            reasoningTokens: false,
            systemPromptTokens: false,
          },
        },
      ] as NonNullable<UsageSnapshotDto["aggregateBuckets"]>,
    }),
  });

  const ctx = await port.collect({
    definition: daily,
    period: { granularity: "day", key: "2026-08-15" },
  });

  assert.ok((ctx.stats?.costUsd ?? 0) > 0);
  assert.equal(ctx.stats?.bySource[0]?.source, "codex");
  assert.ok((ctx.stats?.bySource[0]?.costUsd ?? 0) > 0);
  assert.doesNotMatch(ctx.summary, /¥0\.00/);
});

test("keeps session cost when usage totals cannot be priced", async () => {
  const port = createReportContextPort({
    snapshot: snapshotWith([
      session(localIso(2026, 8, 15), {
        source: "codex",
        totals: { totalTokens: 1_000_000 },
        cost: { knownUsd: 0, estimatedUsd: 12 },
      }),
    ]),
    usage: usageSnapshotWith({
      daily: [
        {
          date: "2026-08-15",
          ...tokenCounts(1_000_000),
          events: 1,
          bySource: { codex: tokenCounts(1_000_000) },
        } as UsageSnapshotDto["daily"][number],
      ],
      aggregateBuckets: [
        {
          date: "2026-08-15",
          latestTimestamp: localIso(2026, 8, 15),
          source: "codex",
          model: "bad\u0000model",
          project: "project",
          ...tokenCounts(1_000_000),
          measurement: "observed",
          events: 1,
          context: {
            textResponses: 0,
            toolCalls: 0,
            tools: [],
            skillCalls: 0,
            toolOutputCalls: 0,
          },
          evidence: {
            textResponses: false,
            toolCalls: false,
            skillCalls: false,
            toolOutputCalls: false,
            reasoningTokens: false,
            systemPromptTokens: false,
          },
        },
      ] as NonNullable<UsageSnapshotDto["aggregateBuckets"]>,
    }),
    usdToCny: () => 7.2,
  });

  const ctx = await port.collect({
    definition: daily,
    period: { granularity: "day", key: "2026-08-15" },
  });

  assert.equal(ctx.stats?.costUsd, 12);
  assert.equal(ctx.stats?.bySource[0]?.costUsd, 12);
  assert.equal(ctx.stats?.costCny, 86.4);
  assert.equal(ctx.stats?.bySource[0]?.costCny, 86.4);
  assert.match(ctx.summary, /¥86\.40/);
});
