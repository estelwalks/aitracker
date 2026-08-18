import assert from "node:assert/strict";
import test from "node:test";

import { compareSummaryToGolden, compareWindow } from "./shadow-compare.ts";
import type { DashboardV2Snapshot, DashboardV2Event } from "../contracts.ts";
import { createDashboardV2View } from "./v2.ts";
import { createDashboardSummaryProjector } from "./summary-projector.ts";
import type { DashboardWindowSummary } from "../summary-contracts.ts";

function event(index: number): DashboardV2Event {
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
      textResponses: 1,
      toolCalls: 1,
      tools: [],
      skillCalls: 1,
      toolOutputCalls: 1,
    },
    evidence: {
      textResponses: true,
      toolCalls: true,
      skillCalls: true,
      toolOutputCalls: true,
      reasoningTokens: reasoningOutputTokens > 0,
      systemPromptTokens: false,
    },
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
      bySourceDay: [],
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

function goldenWindows(snap: DashboardV2Snapshot) {
  const fromView = (
    view: ReturnType<typeof createDashboardV2View>,
  ): DashboardWindowSummary => ({
    period: view.period,
    from: view.from,
    to: view.to,
    hasData: view.hasData,
    totals: view.totals,
    estimatedCostUsd: view.estimatedCostUsd,
    estimatedCostIsPartial: view.estimatedCostIsPartial,
    cacheRate: view.cacheRate,
    comparison: view.comparison,
    sessions: view.sessions,
    skills: view.skills,
    activeTools: view.activeTools,
    usageSupportedToolCount: view.usageSupportedToolCount,
    modelCount: view.modelCount,
    projectCount: view.projectCount,
    trend: view.trend,
    models: view.models,
    projects: view.projects,
    context: view.context,
    contextAvailability: view.contextAvailability,
    tools: view.tools,
  });
  const all = createDashboardV2View(snap, "all");
  return {
    windows: {
      today: fromView(createDashboardV2View(snap, "today")),
      "7d": fromView(createDashboardV2View(snap, "7d")),
      "30d": fromView(createDashboardV2View(snap, "30d")),
      all: fromView(all),
    },
    tools: all.tools,
  };
}

test("shadow compare returns zero diffs for identical projections", () => {
  const snap = snapshot(
    Array.from({ length: 120 }, (_, index) => event(index)),
  );
  const projector = createDashboardSummaryProjector();
  const summary = projector.build({ snapshot: snap, locale: "zh-CN" });
  const golden = goldenWindows(snap);
  assert.deepEqual(compareSummaryToGolden(summary, golden), []);
});

test("shadow compare reports a scalar mismatch", () => {
  const snap = snapshot(
    Array.from({ length: 120 }, (_, index) => event(index)),
  );
  const projector = createDashboardSummaryProjector();
  const summary = projector.build({ snapshot: snap, locale: "zh-CN" });
  const golden = goldenWindows(snap);
  const tampered: ReturnType<typeof goldenWindows> = {
    ...golden,
    windows: {
      ...golden.windows,
      all: {
        ...golden.windows.all,
        totals: { ...golden.windows.all.totals, events: 999 },
      },
    },
  };
  const diffs = compareSummaryToGolden(summary, tampered);
  assert.ok(diffs.some((diff) => diff.name === "window.all.totals"));
});

test("compareWindow compares scalar aggregates", () => {
  const base: DashboardWindowSummary = {
    period: "30d",
    from: "2026-06-22",
    to: "2026-07-21",
    hasData: true,
    totals: {
      events: 10,
      inputTokens: 100,
      cachedInputTokens: 10,
      cacheCreationInputTokens: 5,
      outputTokens: 50,
      reasoningOutputTokens: 0,
      totalTokens: 165,
    },
    estimatedCostUsd: 1.25,
    estimatedCostIsPartial: false,
    cacheRate: null,
    comparison: {
      tokens: { previous: null, deltaPercent: null },
      events: { previous: null, deltaPercent: null },
      sessions: { previous: null, deltaPercent: null, absoluteDelta: null },
      cost: { previous: null, deltaPercent: null },
      cacheRate: { previous: null, deltaPercent: null, deltaPoints: null },
    },
    sessions: null,
    skills: null,
    activeTools: 2,
    usageSupportedToolCount: 3,
    modelCount: 2,
    projectCount: 3,
    trend: [],
    models: [],
    projects: [],
    context: {
      textResponses: 0,
      toolCalls: 0,
      skillCalls: 0,
      toolOutputCalls: 0,
    },
    contextAvailability: {
      textResponses: false,
      toolCalls: false,
      skillCalls: false,
      toolOutputCalls: false,
      reasoningTokens: false,
      systemPromptTokens: false,
    },
    tools: [],
  };
  assert.deepEqual(compareWindow("w", base, { ...base }), []);
  const diffs = compareWindow("w", base, { ...base, activeTools: 5 });
  assert.deepEqual(diffs, [
    { name: "w.activeTools", expected: "2", actual: "5" },
  ]);
});
