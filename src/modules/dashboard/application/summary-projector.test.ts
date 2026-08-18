import assert from "node:assert/strict";
import test from "node:test";

import type { DashboardV2Snapshot, DashboardV2Event } from "../contracts.ts";
import { createDashboardV2View } from "./v2.ts";
import { createDashboardSummaryProjector } from "./summary-projector.ts";

function event(
  index: number,
  overrides: Partial<DashboardV2Event> = {},
): DashboardV2Event {
  const inputTokens = 100 + (index % 1000);
  const cachedInputTokens = index % 200;
  const cacheCreationInputTokens = index % 50;
  const outputTokens = 50 + (index % 300);
  const reasoningOutputTokens = index % 80;
  return {
    source: (["claude-code", "codex", "cursor"] as const)[index % 3],
    timestamp: new Date(
      2026,
      6,
      1 + (index % 20),
      index % 24,
      index % 60,
    ).toISOString(),
    model: (["claude-opus-4", "gpt-5-codex", "gemini-3-pro"] as const)[
      index % 3
    ],
    project: `project-${String(index % 5).padStart(2, "0")}`,
    projectKind: "workspace",
    inputTokens,
    cachedInputTokens,
    cacheCreationInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens:
      inputTokens +
      cachedInputTokens +
      cacheCreationInputTokens +
      outputTokens +
      reasoningOutputTokens,
    context: {
      textResponses: index % 3,
      toolCalls: index % 5,
      tools: [],
      skillCalls: index % 2,
      toolOutputCalls: index % 4,
    },
    evidence: {
      textResponses: true,
      toolCalls: true,
      skillCalls: true,
      toolOutputCalls: true,
      reasoningTokens: reasoningOutputTokens > 0,
      systemPromptTokens: false,
    },
    ...overrides,
  };
}

function snapshot(events: readonly DashboardV2Event[]): DashboardV2Snapshot {
  return {
    generatedAt: "2026-07-21T12:00:00.000Z",
    mode: "real",
    events,
    tools: [
      {
        id: "claude-code",
        name: "Claude Code",
        available: true,
        detected: true,
        usageSupport: "native",
      },
      {
        id: "codex",
        name: "Codex",
        available: true,
        detected: true,
        usageSupport: "native",
      },
      {
        id: "cursor",
        name: "Cursor",
        available: true,
        detected: true,
        usageSupport: "adapter",
      },
    ],
    skills: {
      available: true,
      count: 3,
      generatedAt: "2026-07-21T10:00:00.000Z",
    },
    sessions: {
      available: true,
      generatedAt: "2026-07-21T10:00:00.000Z",
      byProjectDay: [],
      bySourceDay: [
        {
          source: "claude-code",
          date: "2026-07-01",
          count: 2,
          turns: 4,
          editTurns: 1,
          subagentCalls: 0,
        },
        {
          source: "codex",
          date: "2026-07-02",
          count: 1,
          turns: 2,
          editTurns: 0,
          subagentCalls: 1,
        },
      ],
    },
    pricingAvailable: true,
    outputAvailability: {
      securityRuns: { count: null, available: false },
      distillationOutputs: { count: null, available: false },
      distillationBreakdown: { capability: null, memory: null },
      dailyReports: { count: null, available: false },
      weeklyReports: { count: null, available: false },
      monthlyReports: { count: null, available: false },
    },
  };
}

test("summary windows match the golden createDashboardV2View numbers", () => {
  const events = Array.from({ length: 120 }, (_, index) => event(index));
  const snap = snapshot(events);
  const projector = createDashboardSummaryProjector();
  const summary = projector.build({ snapshot: snap, locale: "zh-CN" });

  for (const period of ["today", "7d", "30d", "all"] as const) {
    const golden = createDashboardV2View(snap, period);
    const window = summary.windows[period];
    assert.deepEqual(window.totals, golden.totals, `${period} totals`);
    assert.equal(
      window.estimatedCostUsd,
      golden.estimatedCostUsd,
      `${period} cost`,
    );
    assert.deepEqual(window.trend, golden.trend, `${period} trend`);
    assert.deepEqual(window.models, golden.models, `${period} models`);
    assert.deepEqual(window.projects, golden.projects, `${period} projects`);
    assert.equal(window.sessions, golden.sessions, `${period} sessions`);
    assert.equal(window.cacheRate, golden.cacheRate, `${period} cache rate`);
    assert.deepEqual(
      window.comparison,
      golden.comparison,
      `${period} comparison`,
    );
  }
});

test("daily buckets sum to the all-window totals", () => {
  const events = Array.from({ length: 60 }, (_, index) => event(index));
  const snap = snapshot(events);
  const projector = createDashboardSummaryProjector();
  const summary = projector.build({ snapshot: snap, locale: "zh-CN" });
  const summed = summary.daily.reduce(
    (acc, bucket) => {
      acc.events += bucket.totals.events;
      acc.inputTokens += bucket.totals.inputTokens;
      acc.cachedInputTokens += bucket.totals.cachedInputTokens;
      acc.cacheCreationInputTokens += bucket.totals.cacheCreationInputTokens;
      acc.outputTokens += bucket.totals.outputTokens;
      acc.reasoningOutputTokens += bucket.totals.reasoningOutputTokens;
      acc.totalTokens += bucket.totals.totalTokens;
      return acc;
    },
    {
      events: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
    },
  );
  assert.deepEqual(summed, summary.windows.all.totals);
});

test("custom window matches golden custom view and is cached", () => {
  const events = Array.from({ length: 120 }, (_, index) => event(index));
  const snap = snapshot(events);
  const projector = createDashboardSummaryProjector();
  const custom = projector.buildCustomWindow({
    snapshot: snap,
    locale: "zh-CN",
    from: "2026-07-01",
    to: "2026-07-10",
  });
  const golden = createDashboardV2View(
    snap,
    "custom",
    "2026-07-01",
    "2026-07-10",
  );
  assert.deepEqual(custom.window.totals, golden.totals);
  assert.deepEqual(custom.window.trend, golden.trend);
  assert.equal(custom.window.period, "custom");
  const again = projector.buildCustomWindow({
    snapshot: snap,
    locale: "zh-CN",
    from: "2026-07-01",
    to: "2026-07-10",
  });
  assert.equal(again, custom);
});

test("same revision is served from cache without recomputation", () => {
  const events = Array.from({ length: 40 }, (_, index) => event(index));
  const snap = snapshot(events);
  const projector = createDashboardSummaryProjector();
  const first = projector.build({ snapshot: snap, locale: "en-US" });
  const second = projector.build({ snapshot: snap, locale: "en-US" });
  assert.equal(first, second);
  const otherLocale = projector.build({ snapshot: snap, locale: "ja-JP" });
  assert.notEqual(first, otherLocale);
});

test("revision change invalidates cached projections", () => {
  const events = Array.from({ length: 40 }, (_, index) => event(index));
  const snap1 = snapshot(events);
  const projector = createDashboardSummaryProjector();
  const first = projector.build({ snapshot: snap1, locale: "zh-CN" });
  const snap2 = snapshot([
    ...events,
    event(999, { timestamp: "2026-07-22T00:00:00.000Z" }),
  ]);
  const snap3: DashboardV2Snapshot = {
    ...snap2,
    generatedAt: "2026-07-22T00:00:00.000Z",
  };
  const second = projector.build({ snapshot: snap3, locale: "zh-CN" });
  assert.notEqual(first, second);
  assert.notEqual(first.revision, second.revision);
});

test("summary DTO stays within the 250 KB budget", () => {
  const events = Array.from({ length: 2000 }, (_, index) => event(index));
  const snap = snapshot(events);
  const projector = createDashboardSummaryProjector();
  const summary = projector.build({ snapshot: snap, locale: "zh-CN" });
  assert.ok(summary.meta.dtoBytes > 0);
  assert.ok(
    summary.meta.dtoBytes <= 250 * 1024,
    `dtoBytes ${summary.meta.dtoBytes} exceeds 250 KB`,
  );
});
