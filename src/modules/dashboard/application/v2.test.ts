import assert from "node:assert/strict";
import test from "node:test";
import { createDashboardV2HeroView, createDashboardV2View } from "./v2.ts";
import type { DashboardV2Snapshot } from "../contracts.ts";
import { APP_ID } from "../../../lib/app-config.ts";

const observedEvidence = {
  textResponses: true,
  toolCalls: true,
  skillCalls: true,
  toolOutputCalls: true,
  reasoningTokens: true,
  systemPromptTokens: false,
} as const;

const emptyWorkflow = { turns: 0, editTurns: 0, subagentCalls: 0 } as const;

const snapshot: DashboardV2Snapshot = {
  generatedAt: "2026-08-10T12:00:00.000Z",
  mode: "real",
  pricingAvailable: false,
  outputAvailability: {
    securityRuns: { count: null, available: false },
    distillationOutputs: { count: null, available: false },
    dailyReports: { count: null, available: false },
  },
  skills: { available: true, count: 2, generatedAt: null },
  sessions: {
    available: true,
    generatedAt: null,
    byProjectDay: [
      {
        project: `${APP_ID}_webapp`,
        source: "codex",
        date: "2026-08-10",
        count: 1,
        ...emptyWorkflow,
      },
    ],
    bySourceDay: [
      {
        source: "codex",
        date: "2026-08-10",
        count: 1,
        ...emptyWorkflow,
      },
    ],
  },
  tools: [
    {
      id: "codex",
      name: "Codex CLI",
      available: true,
      detected: true,
      usageSupport: "native",
    },
  ],
  events: [
    {
      source: "codex",
      timestamp: "2026-08-10T10:00:00.000Z",
      model: "gpt-test",
      project: `${APP_ID}_webapp`,
      projectKind: "workspace",
      inputTokens: 80,
      cachedInputTokens: 20,
      cacheCreationInputTokens: 0,
      outputTokens: 20,
      reasoningOutputTokens: 0,
      totalTokens: 100,
      context: {
        textResponses: 1,
        toolCalls: 2,
        skillCalls: 1,
        toolOutputCalls: 1,
      },
      evidence: observedEvidence,
    },
  ],
};

test("Dashboard V2 uses one period for metrics, trend, cards and context", () => {
  const view = createDashboardV2View(
    snapshot,
    "custom",
    "2026-08-10",
    "2026-08-10",
  );

  assert.equal(view.totals.totalTokens, 100);
  assert.equal(view.trend[0]?.tokens, 100);
  assert.equal(view.tools[0]?.tokens, 100);
  assert.equal(view.context.toolCalls, 2);
  assert.equal(view.sessions, 1);
  assert.equal(view.estimatedCostUsd, null);
  assert.equal(view.models[0]?.share, 100);
  assert.equal(view.modelCount, 1);
  assert.equal(view.projectCount, 1);
  assert.equal(view.usageSupportedToolCount, 1);
  assert.equal(view.contextAvailability.reasoningTokens, true);
  assert.equal(view.contextAvailability.systemPromptTokens, false);
  assert.equal(view.outputAvailability.securityRuns.count, null);
  assert.equal(view.outputAvailability.securityRuns.available, false);
  assert.equal(view.outputAvailability.distillationOutputs.count, null);
  assert.equal(view.outputAvailability.dailyReports.count, null);
  assert.equal(view.calendarSummary.activeDays, 1);
  assert.deepEqual(view.trend[0], {
    date: "2026-08-10",
    tokens: 100,
    events: 1,
    cacheTokens: 20,
    netInputTokens: 80,
    outputTokens: 20,
    sessions: 1,
    previousTokens: 0,
  });
});

test("Dashboard V2 excludes quick conversations from project statistics", () => {
  const quickConversation = {
    ...snapshot.events[0]!,
    project: "quick-conversation",
    projectKind: "quick-conversation" as const,
    totalTokens: 200,
  };
  const view = createDashboardV2View(
    { ...snapshot, events: [...snapshot.events, quickConversation] },
    "custom",
    "2026-08-10",
    "2026-08-10",
  );

  assert.equal(view.totals.events, 2);
  assert.equal(view.projectCount, 1);
  assert.deepEqual(
    view.projects.map((project) => project.key),
    [`${APP_ID}_webapp`],
  );
});

test("Dashboard V2 aligns a real previous window for the composed trend", () => {
  const event = (timestamp: string, totalTokens: number) => ({
    ...snapshot.events[0]!,
    timestamp,
    inputTokens: totalTokens - 20,
    cachedInputTokens: 20,
    outputTokens: 0,
    totalTokens,
  });
  const view = createDashboardV2View(
    {
      ...snapshot,
      events: [
        event("2026-08-09T10:00:00.000Z", 40),
        event("2026-08-10T10:00:00.000Z", 100),
      ],
    },
    "custom",
    "2026-08-10",
    "2026-08-10",
  );

  assert.equal(view.trend[0]?.tokens, 100);
  assert.equal(view.trend[0]?.previousTokens, 40);
  assert.equal(view.trend[0]?.cacheTokens, 20);
  assert.equal(view.trend[0]?.netInputTokens, 80);
});

test("Dashboard V2 zero-fills calendar days and calculates a local-day streak", () => {
  const view = createDashboardV2View(
    snapshot,
    "custom",
    "2026-08-09",
    "2026-08-11",
  );

  assert.deepEqual(
    view.trend.map((point) => [point.date, point.tokens]),
    [
      ["2026-08-09", 0],
      ["2026-08-10", 100],
      ["2026-08-11", 0],
    ],
  );
  assert.deepEqual(
    view.calendar
      .slice(-3)
      .map((point) => [point.date, point.active, point.tokens]),
    [
      ["2026-08-08", false, 0],
      ["2026-08-09", false, 0],
      ["2026-08-10", true, 100],
    ],
  );
  assert.deepEqual(view.calendarSummary, {
    days: 365,
    activeDays: 1,
    longestStreak: 1,
    totalTokens: 100,
  });
});

test("Dashboard V2 keeps a 365-day calendar independent of the 30-day metrics range", () => {
  const now = new Date();
  const liveSnapshot: DashboardV2Snapshot = {
    ...snapshot,
    generatedAt: now.toISOString(),
    events: [
      {
        ...snapshot.events[0]!,
        timestamp: now.toISOString(),
        totalTokens: 123,
      },
    ],
  };
  const view = createDashboardV2View(liveSnapshot, "30d");

  assert.equal(view.calendarSummary.days, 365);
  assert.equal(view.calendar.length, 365);
  assert.equal(view.calendarSummary.totalTokens, 123);
});

test("Dashboard V2 does not invent unavailable session or pricing values", () => {
  const view = createDashboardV2View(
    {
      ...snapshot,
      pricingAvailable: false,
      sessions: {
        available: false,
        generatedAt: null,
        byProjectDay: [],
        bySourceDay: [],
      },
    },
    "custom",
    "2026-08-10",
    "2026-08-10",
  );

  assert.equal(view.sessions, null);
  assert.equal(view.estimatedCostUsd, null);
});

test("Dashboard V2 preserves catalog detection while keeping activity range-specific", () => {
  const view = createDashboardV2View(
    {
      ...snapshot,
      tools: [
        ...snapshot.tools,
        {
          id: "cursor",
          name: "Cursor",
          available: true,
          detected: true,
          usageSupport: "adapter",
        },
        {
          id: "hidden",
          name: "Hidden",
          available: true,
          detected: false,
          usageSupport: "unsupported",
        },
      ],
    },
    "custom",
    "2026-08-09",
    "2026-08-09",
  );

  assert.equal(view.hasData, false);
  assert.equal(view.activeTools, 0);
  assert.equal(view.usageSupportedToolCount, 2);
  assert.deepEqual(
    view.tools.map((tool) => [tool.id, tool.events, tool.tokens]),
    [
      ["codex", 0, 0],
      ["cursor", 0, 0],
    ],
  );
});

test("Dashboard V2 derives safe previous-window, model and project aggregates", () => {
  const event = (
    timestamp: string,
    project: string,
    model: string,
    totalTokens: number,
  ): DashboardV2Snapshot["events"][number] => ({
    ...snapshot.events[0]!,
    timestamp,
    project,
    model,
    inputTokens: totalTokens - 20,
    cachedInputTokens: 20,
    outputTokens: 0,
    totalTokens,
  });
  const comparisonSnapshot: DashboardV2Snapshot = {
    ...snapshot,
    pricingAvailable: true,
    sessions: {
      available: true,
      generatedAt: null,
      byProjectDay: [
        {
          project: "alpha",
          source: "codex",
          date: "2026-08-08",
          count: 1,
          ...emptyWorkflow,
        },
        {
          project: "alpha",
          source: "codex",
          date: "2026-08-10",
          count: 2,
          ...emptyWorkflow,
        },
      ],
      bySourceDay: [
        {
          source: "codex",
          date: "2026-08-08",
          count: 2,
          ...emptyWorkflow,
        },
        {
          source: "codex",
          date: "2026-08-10",
          count: 3,
          ...emptyWorkflow,
        },
      ],
    },
    events: [
      event("2026-08-08T10:00:00.000Z", "alpha", "gpt-4o", 100),
      event("2026-08-09T10:00:00.000Z", "alpha", "gpt-4o", 100),
      event("2026-08-08T12:00:00.000Z", "beta", "gpt-4o-mini", 100),
      event("2026-08-09T12:00:00.000Z", "beta", "gpt-4o-mini", 100),
      event("2026-08-10T10:00:00.000Z", "alpha", "gpt-4o", 200),
      event("2026-08-11T10:00:00.000Z", "alpha", "gpt-4o", 200),
      event("2026-08-10T12:00:00.000Z", "beta", "gpt-4o-mini", 100),
      event("2026-08-11T12:00:00.000Z", "beta", "gpt-4o-mini", 100),
    ],
  };
  const view = createDashboardV2View(
    comparisonSnapshot,
    "custom",
    "2026-08-10",
    "2026-08-11",
  );

  assert.equal(view.comparison.tokens.previous, 400);
  assert.equal(view.comparison.tokens.deltaPercent, 50);
  assert.equal(view.comparison.events.previous, 4);
  assert.equal(view.comparison.cacheRate.deltaPoints, -6.666666666666666);
  assert.equal(view.models[0]?.estimatedCostUsd != null, true);
  assert.equal(view.models[0]?.events, 2);
  assert.equal(view.models[0]?.share, (400 / 600) * 100);
  assert.equal(view.models[0]?.deltaPercent, 100);
  assert.equal(view.projects[0]?.key, "alpha");
  assert.equal(view.projects[0]?.sessions, 2);
  assert.equal(view.projects[0]?.deltaPercent, 100);
  assert.equal(view.modelCount, 2);
  assert.equal(view.projectCount, 2);
});

test("Dashboard V2 keeps unavailable context distinct from an observed zero", () => {
  const view = createDashboardV2View(
    {
      ...snapshot,
      events: snapshot.events.map((event) => ({
        ...event,
        context: { ...event.context, toolOutputCalls: 0 },
        evidence: { ...event.evidence, toolOutputCalls: false },
      })),
    },
    "custom",
    "2026-08-10",
    "2026-08-10",
  );

  assert.equal(view.context.toolOutputCalls, 0);
  assert.equal(view.contextAvailability.toolOutputCalls, false);
  assert.equal(view.context.skillCalls, 1);
  assert.equal(view.contextAvailability.skillCalls, true);
});

test("Dashboard V2 retains Top 10 projects plus a real aggregated rest row", () => {
  const events = Array.from({ length: 12 }, (_, index) => ({
    ...snapshot.events[0]!,
    timestamp: `2026-08-10T${String(index + 1).padStart(2, "0")}:00:00.000Z`,
    project: `project-${String(index + 1).padStart(2, "0")}`,
    totalTokens: 120 - index,
  }));
  const view = createDashboardV2View(
    { ...snapshot, events },
    "custom",
    "2026-08-10",
    "2026-08-10",
  );

  assert.equal(view.projectCount, 12);
  assert.equal(view.projects.length, 11);
  assert.equal(view.projects[9]?.key, "project-10");
  assert.equal(view.projects[10]?.key, "other");
  assert.equal(
    view.projects[10]?.tokens,
    events[10]!.totalTokens + events[11]!.totalTokens,
  );
});

test("Dashboard V2 Hero derives live listener state and insights from safe observations", () => {
  const hero = createDashboardV2HeroView({
    snapshot,
    activeInsightCount: 2,
    now: new Date("2026-08-10T10:10:00.000Z"),
    monitoring: {
      module: "monitoring",
      running: true,
      startedAt: "2026-08-10T10:00:00.000Z",
      heartbeatAt: "2026-08-10T10:09:00.000Z",
      pendingCount: 1,
      collectors: [
        { id: "usage", state: "healthy", pending: false },
        { id: "skills", state: "healthy", pending: false },
        { id: "sessions", state: "healthy", pending: false },
        { id: "security", state: "healthy", pending: false },
      ],
      security: {
        assessedAt: "2026-08-10T10:09:00.000Z",
        discoveredAssetCount: 3,
        assessedAssetCount: 3,
        failedAssetCount: 0,
        cleanCount: 3,
        suspiciousCount: 0,
        dangerousCount: 0,
        unknownCount: 0,
      },
    },
  });

  assert.deepEqual(hero.monitoring, {
    health: "listening",
    isLive: true,
    liveTools: 1,
    detectedTools: 1,
    pendingCount: 3,
  });
  assert.deepEqual(
    hero.insights.map((insight) => insight.kind),
    ["usage", "cache", "security", "monitoring"],
  );
  const usageInsight = hero.insights.find(
    (insight) => insight.kind === "usage",
  );
  assert.equal(usageInsight?.toolName, "Codex CLI");
  assert.equal(
    usageInsight?.tokens,
    createDashboardV2View(snapshot, "all").tools[0]?.tokens,
    "a named top-tool insight must not show all tools' combined token total",
  );
});

test("Dashboard V2 Hero never presents a missing monitoring read as live", () => {
  const hero = createDashboardV2HeroView({
    snapshot,
    activeInsightCount: 0,
    monitoring: null,
    now: new Date("2026-08-10T10:10:00.000Z"),
  });

  assert.equal(hero.monitoring.health, "unavailable");
  assert.equal(hero.monitoring.isLive, false);
  assert.equal(hero.monitoring.liveTools, 1);
});
