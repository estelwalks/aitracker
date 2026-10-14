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

type AggregateBucket = NonNullable<
  UsageSnapshotDto["aggregateBuckets"]
>[number];

function aggregateBucket(
  project: string,
  totalTokens: number,
  extra: Partial<AggregateBucket> = {},
): AggregateBucket {
  return {
    date: "2026-08-15",
    latestTimestamp: localIso(2026, 8, 15),
    source: "codex",
    model: "test-model",
    project,
    ...tokenCounts(totalTokens),
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
    ...extra,
  };
}

type TestBucket = NonNullable<UsageSnapshotDto["aggregateBuckets"]>[number];

/** Compact aggregate-bucket factory for behavior/repeated signal tests. */
function bucket(date: string, extra: Partial<TestBucket> = {}): TestBucket {
  return {
    date,
    latestTimestamp: `${date}T02:00:00.000Z`,
    source: "codex",
    model: "test-model",
    project: "test-project",
    projectLabel: "test-project",
    ...tokenCounts(1000),
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
    ...extra,
  };
}

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

test("reports exclude internal review sessions and hide prompt-derived long titles", async () => {
  const rawPromptTitle =
    "后面用这个项目进行开发，然后现在把日报周报的模板，单独抽出来，作为尤其是模板，而且还要分4种语言，就是生成日报或周报或…";
  const port = createReportContextPort({
    snapshot: snapshotWith([
      session(localIso(2026, 8, 15), {
        source: "codex",
        title: rawPromptTitle,
        projectKey: "aitracker",
        model: "gpt-5.6-sol",
      }),
      session(localIso(2026, 8, 15), {
        source: "codex",
        title:
          "The following is the Codex agent history whose request action you are assessing.",
        projectKey: "aitracker",
        model: "codex-auto-review",
        turns: 12,
      }),
    ]),
  });

  const ctx = await port.collect({
    definition: daily,
    period: { granularity: "day", key: "2026-08-15" },
  });

  assert.equal(ctx.stats?.sessions, 1);
  assert.equal(ctx.stats?.turns, 5);
  assert.equal(ctx.stats?.sessionsDetail?.length, 1);
  assert.equal(ctx.stats?.sessionsDetail?.[0]?.title, "aitracker · codex");
  assert.doesNotMatch(
    ctx.stats?.sessionsDetail?.[0]?.title ?? "",
    /后面用这个/,
  );
});

test("R5 privacy: over-72-char session titles degrade to project · source", async () => {
  const longTitle =
    "这是一个远超七十二个字符的会话标题，用于验证报告侧不会把超长标题写入固定正文或模型输入，而是降级为项目与来源的组合标签，避免泄漏完整会话标题内容，并且始终保持隐私边界。";
  assert.ok(Array.from(longTitle).length > 72);
  const port = createReportContextPort({
    snapshot: snapshotWith([
      session(localIso(2026, 8, 15), {
        source: "codex",
        title: longTitle,
        projectKey: "aitracker",
      }),
    ]),
  });

  const ctx = await port.collect({
    definition: daily,
    period: { granularity: "day", key: "2026-08-15" },
  });

  const title = ctx.stats?.sessionsDetail?.[0]?.title ?? "";
  assert.equal(title, "aitracker · codex");
  assert.ok(Array.from(title).length <= 72);
  assert.doesNotMatch(title, /远超七十二/);
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

test("groups projects by opaque identity and never exposes legacy path labels", async () => {
  const firstIdentity = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa000000000001";
  const secondIdentity = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb000000000002";
  const unresolvedRef = "/Volumes/team/private/scratch";
  const identityRequests: string[] = [];
  const port = createReportContextPort({
    snapshot: snapshotWith([
      session(localIso(2026, 8, 15), {
        projectKey: "~/Desktop/private/scratch",
        projectIdentity: firstIdentity,
      }),
    ]),
    usage: usageSnapshotWith({
      daily: [
        {
          date: "2026-08-15",
          ...tokenCounts(300),
          events: 2,
          bySource: { codex: tokenCounts(300) },
        } as UsageSnapshotDto["daily"][number],
      ],
      aggregateBuckets: [
        aggregateBucket("/Users/alice/Desktop/private/scratch", 200, {
          projectRefHash: firstIdentity,
          projectLabel: "~/Desktop/private/scratch",
          projectKind: "quick-conversation",
        }),
        aggregateBucket(unresolvedRef, 100, {
          projectLabel: "/Volumes/team/private/scratch",
          projectKind: "workspace",
        }),
      ],
    }),
    projectIdentity: (projectRef) => {
      identityRequests.push(projectRef);
      return secondIdentity;
    },
  });

  const ctx = await port.collect({
    definition: daily,
    period: { granularity: "day", key: "2026-08-15" },
  });

  assert.deepEqual(identityRequests, [unresolvedRef]);
  assert.deepEqual(ctx.stats?.projects, [
    "scratch · 000000000001",
    "scratch · 000000000002",
  ]);
  assert.deepEqual(
    ctx.stats?.byProject?.map(({ label, kind, tokens }) => ({
      label,
      kind,
      tokens,
    })),
    [
      {
        label: "scratch · 000000000001",
        kind: "conversation",
        tokens: 200,
      },
      {
        label: "scratch · 000000000002",
        kind: "project",
        tokens: 100,
      },
    ],
  );
  assert.equal(ctx.stats?.sessionsDetail?.[0]?.project, "scratch");
  assert.equal(ctx.stats?.activeProjectCount, 2);
  assert.equal(ctx.stats?.byProject?.[0]?.sessions, 1);
  assert.equal(ctx.stats?.byProject?.[1]?.sessions, 0);
  const serializedContext = JSON.stringify(ctx);
  assert.doesNotMatch(serializedContext, /~\//u);
  assert.doesNotMatch(serializedContext, /\/Users\/alice|\/Volumes\/team/u);
  assert.doesNotMatch(serializedContext, /Desktop|private/u);
  assert.doesNotMatch(serializedContext, new RegExp(firstIdentity, "u"));
});

test("reports never use a persisted project identity as a quick label", async () => {
  const projectIdentity = "q".repeat(43);
  const port = createReportContextPort({
    usage: usageSnapshotWith({
      daily: [
        {
          date: "2026-08-15",
          ...tokenCounts(100),
          events: 1,
          bySource: { codex: tokenCounts(100) },
        } as UsageSnapshotDto["daily"][number],
      ],
      aggregateBuckets: [
        aggregateBucket(projectIdentity, 100, {
          projectRefHash: projectIdentity,
          projectLabel: "quick-conversation",
          projectKind: "quick-conversation",
        }),
      ],
    }),
  });

  const ctx = await port.collect({
    definition: daily,
    period: { granularity: "day", key: "2026-08-15" },
  });

  assert.deepEqual(ctx.stats?.projects, ["quick-conversation"]);
  assert.equal(ctx.stats?.byProject?.[0]?.label, "quick-conversation");
  assert.doesNotMatch(JSON.stringify(ctx), new RegExp(projectIdentity, "u"));
});

test("omits edit metrics when no edits are identified", async () => {
  const port = createReportContextPort({
    snapshot: snapshotWith([
      session(localIso(2026, 8, 15), {
        editTurns: 0,
        totals: { totalTokens: 1000 },
      }),
    ]),
    usage: usageSnapshotWith({
      daily: [
        {
          date: "2026-08-15",
          ...tokenCounts(1000),
          events: 1,
          bySource: { codex: tokenCounts(1000) },
        } as UsageSnapshotDto["daily"][number],
      ],
      aggregateBuckets: [
        {
          date: "2026-08-15",
          latestTimestamp: localIso(2026, 8, 15),
          source: "codex",
          model: "test-model",
          project: "test-project",
          projectLabel: "test-project",
          ...tokenCounts(1000),
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
      ] as NonNullable<UsageSnapshotDto["aggregateBuckets"]>,
    }),
  });
  const ctx = await port.collect({
    definition: daily,
    period: { granularity: "day", key: "2026-08-15" },
  });

  assert.equal(ctx.stats?.edits, 0);
  assert.doesNotMatch(ctx.summary, /代码改动/);
  assert.match(ctx.summary, /\| Agent \| 会话 \| Tokens \| 成本 \| 时长 \|/);
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

test("derives approximate behavior distribution from aggregate tool categories", async () => {
  const port = createReportContextPort({
    snapshot: snapshotWith([]),
    usage: usageSnapshotWith({
      daily: [],
      aggregateBuckets: [
        bucket("2026-08-15", {
          ...tokenCounts(4000),
          events: 1,
          context: {
            textResponses: 0,
            toolCalls: 1,
            tools: [{ name: "ApplyPatch", category: "execution", calls: 1 }],
            skillCalls: 0,
            toolOutputCalls: 0,
          },
        }),
        bucket("2026-08-15", {
          ...tokenCounts(2000),
          events: 1,
          context: {
            textResponses: 0,
            toolCalls: 1,
            tools: [{ name: "fetch", category: "browser", calls: 1 }],
            skillCalls: 0,
            toolOutputCalls: 0,
          },
        }),
        bucket("2026-08-15", {
          ...tokenCounts(1000),
          events: 1,
          context: {
            textResponses: 1,
            toolCalls: 0,
            tools: [],
            skillCalls: 0,
            toolOutputCalls: 0,
          },
        }),
      ],
    }),
  });
  const ctx = await port.collect({
    definition: daily,
    period: { granularity: "day", key: "2026-08-15" },
  });

  assert.equal(ctx.stats?.behaviors?.length, 3);
  assert.equal(ctx.stats?.behaviors?.[0]?.label, "代码生成/重构");
  assert.equal(ctx.stats?.behaviors?.[0]?.tokenShare, 4000 / 7000);
  assert.equal(ctx.stats?.behaviors?.[0]?.eventShare, 1 / 3);
  assert.match(
    ctx.summary,
    /行为分布（基于工具使用的近似估算）：代码生成\/重构 57%/,
  );
  assert.match(ctx.summary, /对话\/问答 14%/);
});

test("classifies debug-style tools into the debug behavior", async () => {
  const port = createReportContextPort({
    snapshot: snapshotWith([]),
    usage: usageSnapshotWith({
      daily: [],
      aggregateBuckets: [
        bucket("2026-08-15", {
          ...tokenCounts(2000),
          context: {
            textResponses: 0,
            toolCalls: 1,
            tools: [{ name: "runTests", category: "execution", calls: 1 }],
            skillCalls: 0,
            toolOutputCalls: 0,
          },
        }),
        bucket("2026-08-15", {
          ...tokenCounts(1000),
          context: {
            textResponses: 0,
            toolCalls: 1,
            tools: [{ name: "ApplyPatch", category: "execution", calls: 1 }],
            skillCalls: 0,
            toolOutputCalls: 0,
          },
        }),
      ],
    }),
  });
  const ctx = await port.collect({
    definition: daily,
    period: { granularity: "day", key: "2026-08-15" },
  });

  assert.equal(ctx.stats?.behaviors?.[0]?.label, "调试");
  assert.equal(ctx.stats?.behaviors?.[1]?.label, "代码生成/重构");
});

test("omits behavior distribution when the period has no tool signal", async () => {
  const port = createReportContextPort({
    snapshot: snapshotWith([]),
    usage: usageSnapshotWith({
      daily: [],
      aggregateBuckets: [
        bucket("2026-08-15", {
          context: {
            textResponses: 1,
            toolCalls: 0,
            tools: [],
            skillCalls: 0,
            toolOutputCalls: 0,
          },
        }),
      ],
    }),
  });
  const ctx = await port.collect({
    definition: daily,
    period: { granularity: "day", key: "2026-08-15" },
  });

  assert.equal(ctx.stats?.behaviors, undefined);
  assert.doesNotMatch(ctx.summary, /行为分布/);
});

test("summary includes per-agent tool usage from aggregate tool details", async () => {
  const port = createReportContextPort({
    snapshot: snapshotWith([]),
    usage: usageSnapshotWith({
      daily: [],
      aggregateBuckets: [
        bucket("2026-08-15", {
          source: "codex",
          ...tokenCounts(4000),
          events: 1,
          context: {
            textResponses: 0,
            toolCalls: 2,
            tools: [
              { name: "exec_command", category: "execution", calls: 22 },
              { name: "apply_patch", category: "execution", calls: 3 },
            ],
            skillCalls: 0,
            toolOutputCalls: 0,
          },
        }),
        bucket("2026-08-15", {
          source: "claude-code",
          ...tokenCounts(2000),
          events: 1,
          context: {
            textResponses: 0,
            toolCalls: 1,
            tools: [{ name: "Bash", category: "execution", calls: 5 }],
            skillCalls: 0,
            toolOutputCalls: 0,
          },
        }),
      ],
    }),
  });
  const ctx = await port.collect({
    definition: daily,
    period: { granularity: "day", key: "2026-08-15" },
  });

  assert.equal(ctx.stats?.toolUsageBySource?.length, 2);
  const codex = ctx.stats?.toolUsageBySource?.find((r) => r.source === "codex");
  assert.equal(codex?.tools[0]?.name, "exec_command");
  assert.equal(codex?.tools[0]?.calls, 22);
  assert.equal(codex?.tools[1]?.name, "apply_patch");
  assert.equal(codex?.tools[1]?.calls, 3);
  assert.match(ctx.summary, /主要工具行为（脱敏汇总，按 Agent）：/);
  assert.match(ctx.summary, /codex：exec_command ×22、apply_patch ×3/);
  assert.match(ctx.summary, /claude-code：Bash ×5/);
});

test("summary omits tool-usage section when no aggregate tools exist", async () => {
  const port = createReportContextPort({
    snapshot: snapshotWith([]),
    usage: usageSnapshotWith({
      daily: [],
      aggregateBuckets: [
        bucket("2026-08-15", {
          context: {
            textResponses: 1,
            toolCalls: 0,
            tools: [],
            skillCalls: 0,
            toolOutputCalls: 0,
          },
        }),
      ],
    }),
  });
  const ctx = await port.collect({
    definition: daily,
    period: { granularity: "day", key: "2026-08-15" },
  });

  assert.equal(ctx.stats?.toolUsageBySource?.length, 0);
  assert.doesNotMatch(ctx.summary, /主要工具行为/);
});

test("summary includes main sessions with sanitized titles and projects", async () => {
  const port = createReportContextPort({
    snapshot: snapshotWith([
      session(localIso(2026, 8, 15, 9), {
        source: "codex",
        title: "修复登录态丢失",
        projectKey: "aitracker",
        turns: 8,
        totals: { totalTokens: 3000 },
      }),
      session(localIso(2026, 8, 15, 11), {
        source: "codex",
        title: "补全文档",
        projectKey: "aitracker",
        turns: 3,
        totals: { totalTokens: 1000 },
      }),
    ]),
  });
  const ctx = await port.collect({
    definition: daily,
    period: { granularity: "day", key: "2026-08-15" },
  });

  assert.match(ctx.summary, /主要会话：/);
  assert.match(ctx.summary, /「修复登录态丢失」（aitracker）：8 轮、3\.0K/);
  assert.match(ctx.summary, /「补全文档」（aitracker）：3 轮、1\.0K/);
});

test("flags repeated sessions with similar titles in the same project", async () => {
  const port = createReportContextPort({
    snapshot: snapshotWith([
      session(localIso(2026, 8, 15, 9), {
        source: "codex",
        title: "修复登录态丢失的问题",
        projectKey: "aitracker",
        turns: 8,
        totals: { totalTokens: 3000 },
      }),
      session(localIso(2026, 8, 15, 14), {
        source: "codex",
        title: "继续修复登录态丢失的问题",
        projectKey: "aitracker",
        turns: 5,
        totals: { totalTokens: 2000 },
      }),
      session(localIso(2026, 8, 15, 16), {
        source: "codex",
        title: "补全文档",
        projectKey: "aitracker",
        turns: 3,
        totals: { totalTokens: 1000 },
      }),
    ]),
  });
  const ctx = await port.collect({
    definition: daily,
    period: { granularity: "day", key: "2026-08-15" },
  });

  const repeatedTitles = (ctx.stats?.sessionsDetail ?? [])
    .filter((row) => row.repeated)
    .map((row) => row.title);
  assert.deepEqual(repeatedTitles, [
    "修复登录态丢失的问题",
    "继续修复登录态丢失的问题",
  ]);
  assert.equal(
    (ctx.stats?.sessionsDetail ?? []).find((row) => row.title === "补全文档")
      ?.repeated,
    false,
  );
});

test("short or distinct titles are not flagged as repeated", async () => {
  const port = createReportContextPort({
    snapshot: snapshotWith([
      session(localIso(2026, 8, 15, 9), { title: "T", projectKey: "p1" }),
      session(localIso(2026, 8, 15, 14), { title: "T", projectKey: "p1" }),
      session(localIso(2026, 8, 15, 16), {
        title: "完全不同的主题A",
        projectKey: "p1",
      }),
      session(localIso(2026, 8, 15, 18), {
        title: "完全不同的主题B",
        projectKey: "p1",
      }),
    ]),
  });
  const ctx = await port.collect({
    definition: daily,
    period: { granularity: "day", key: "2026-08-15" },
  });

  assert.ok(
    (ctx.stats?.sessionsDetail ?? []).every((row) => row.repeated === false),
  );
});

test("repeated signal also looks at the previous comparison period", async () => {
  const port = createReportContextPort({
    snapshot: snapshotWith([
      session(localIso(2026, 8, 14, 10), {
        source: "codex",
        title: "排查数据库锁竞争",
        projectKey: "aitracker",
        turns: 4,
        totals: { totalTokens: 1200 },
      }),
      session(localIso(2026, 8, 15, 10), {
        source: "codex",
        title: "继续排查数据库锁竞争",
        projectKey: "aitracker",
        turns: 6,
        totals: { totalTokens: 2500 },
      }),
    ]),
  });
  const ctx = await port.collect({
    definition: daily,
    period: { granularity: "day", key: "2026-08-15" },
  });

  assert.equal(ctx.stats?.sessionsDetail?.[0]?.repeated, true);
});

test("weekly summary includes repeated-work and durable-output signals", async () => {
  const port = createReportContextPort({
    snapshot: snapshotWith([
      session(localIso(2026, 8, 10, 9), {
        source: "codex",
        title: "修复登录态丢失的问题",
        projectKey: "aitracker",
        turns: 8,
        totals: { totalTokens: 3000 },
      }),
      session(localIso(2026, 8, 12, 14), {
        source: "codex",
        title: "继续修复登录态丢失的问题",
        projectKey: "aitracker",
        turns: 5,
        totals: { totalTokens: 2000 },
      }),
    ]),
    output: {
      collect: async ({ from, to }) => ({
        skills: 1,
        knowledge: 2,
        distillations: 0,
      }),
    },
  });
  const ctx = await port.collect({
    definition: weekly,
    period: { granularity: "week", key: "2026-08-10" },
  });

  assert.match(ctx.summary, /重复工作：2 个会话存在重复任务迹象/);
  assert.match(
    ctx.summary,
    /沉淀与产出：本时段新增 Skill 1 个、记忆\/知识 2 个、蒸馏成果 0 个/,
  );
  assert.equal(ctx.stats?.outputs?.skills, 1);
  assert.equal(ctx.stats?.outputs?.knowledge, 2);
  assert.equal(ctx.stats?.outputs?.distillations, 0);
});

test("summary omits output signal when no output port is provided", async () => {
  const port = createReportContextPort({
    snapshot: snapshotWith([
      session(localIso(2026, 8, 15, 9), {
        projectKey: "p1",
        title: "工作A",
      }),
    ]),
  });
  const ctx = await port.collect({
    definition: daily,
    period: { granularity: "day", key: "2026-08-15" },
  });
  assert.doesNotMatch(ctx.summary, /沉淀与产出/);
  assert.equal(ctx.stats?.outputs, undefined);
});

test("summary omits output signal for zero counts or a throwing port", async () => {
  const base = snapshotWith([
    session(localIso(2026, 8, 15, 9), { projectKey: "p1", title: "工作A" }),
  ]);
  const zero = createReportContextPort({
    snapshot: base,
    output: {
      collect: async () => ({ skills: 0, knowledge: 0, distillations: 0 }),
    },
  });
  const zeroCtx = await zero.collect({
    definition: daily,
    period: { granularity: "day", key: "2026-08-15" },
  });
  assert.doesNotMatch(zeroCtx.summary, /沉淀与产出/);
  assert.equal(zeroCtx.stats?.outputs, undefined);

  const throwing = createReportContextPort({
    snapshot: base,
    output: {
      collect: async () => {
        throw new Error("output port unavailable");
      },
    },
  });
  const throwCtx = await throwing.collect({
    definition: daily,
    period: { granularity: "day", key: "2026-08-15" },
  });
  assert.doesNotMatch(throwCtx.summary, /沉淀与产出/);
  assert.equal(throwCtx.stats?.outputs, undefined);
});

test("a session running past the covered day is flagged cross-period", async () => {
  const port = createReportContextPort({
    snapshot: snapshotWith([
      session(localIso(2026, 8, 20, 10), {
        title: "same-day",
        endedAt: localIso(2026, 8, 20, 11),
        durationMs: 60 * 60 * 1000,
      }),
      // Active duration stays inside the day, but the session resumed later —
      // only endedAt reveals that it ran past the covered day.
      session(localIso(2026, 8, 20, 23), {
        title: "spills-over",
        endedAt: localIso(2026, 8, 21, 3),
        durationMs: 60 * 60 * 1000,
      }),
    ]),
  });

  const ctx = await port.collect({
    definition: daily,
    period: { granularity: "day", key: "2026-08-20" },
  });

  const rows = ctx.stats?.sessionsDetail ?? [];
  const byTitle = new Map(rows.map((row) => [row.title, row]));
  assert.equal(byTitle.get("same-day")?.crossPeriod, false);
  assert.equal(byTitle.get("spills-over")?.crossPeriod, true);
});

test("content insight stays off by default and never opens a transcript", async () => {
  let reads = 0;
  const port = createReportContextPort({
    snapshot: snapshotWith([
      session(localIso(2026, 8, 20, 10), {
        sessionId: "s-1",
        title: "拉取这个项目",
      }),
    ]),
    sessionContent: {
      enabled: () => false,
      read: async () => {
        reads += 1;
        return { messages: [{ role: "user", text: "拉取这个项目" }] };
      },
    },
  });

  const ctx = await port.collect({
    definition: daily,
    period: { granularity: "day", key: "2026-08-20" },
  });

  assert.equal(reads, 0);
  assert.equal(ctx.sessionDigests, undefined);
});

test("enabling content insight digests the covered sessions", async () => {
  const read: string[] = [];
  const port = createReportContextPort({
    snapshot: snapshotWith([
      session(localIso(2026, 8, 20, 10), {
        sessionId: "s-1",
        title: "拉取这个项目",
        totals: { totalTokens: 5000 },
      }),
      session(localIso(2026, 8, 20, 11), {
        sessionId: "s-2",
        title: "小会话",
        totals: { totalTokens: 10 },
      }),
    ]),
    sessionContent: {
      enabled: () => true,
      read: async (ref) => {
        read.push(ref.sessionId);
        return {
          messages: [
            { role: "user", text: "<system>noise" },
            { role: "user", text: "拉取这个项目，路径 /Users/x/app" },
            {
              role: "assistant",
              text: "已经克隆仓库，分析完结构，补齐文档并成功打包桌面应用，随后启动应用做了真实端到端验证。",
            },
          ],
        };
      },
    },
  });

  const ctx = await port.collect({
    definition: daily,
    period: { granularity: "day", key: "2026-08-20" },
  });

  // Highest-token session first, both digested.
  assert.deepEqual(read, ["s-1", "s-2"]);
  const digests = ctx.sessionDigests ?? [];
  assert.equal(digests.length, 2);
  assert.equal(digests[0]?.title, "拉取这个项目");
  assert.deepEqual(digests[0]?.goals, ["拉取这个项目，路径 <path>"]);
  assert.equal(digests[0]?.redacted, true);
});

test("a failing content reader degrades to a statistics-only context", async () => {
  const port = createReportContextPort({
    snapshot: snapshotWith([
      session(localIso(2026, 8, 20, 10), { sessionId: "s-1", title: "T" }),
    ]),
    sessionContent: {
      enabled: () => true,
      read: async () => {
        throw new Error("transcript unavailable");
      },
    },
  });

  const ctx = await port.collect({
    definition: daily,
    period: { granularity: "day", key: "2026-08-20" },
  });

  assert.equal(ctx.sessionDigests, undefined);
  assert.ok(ctx.stats);
});
