import assert from "node:assert/strict";
import test from "node:test";

import { buildToolOverview } from "./tool-overview.ts";
import type { DashboardV2Snapshot } from "../../dashboard/contracts.ts";
import { APP_ID } from "../../../lib/app-config.ts";

const codexEvidence = {
  textResponses: true,
  toolCalls: true,
  skillCalls: true,
  toolOutputCalls: true,
  reasoningTokens: true,
  systemPromptTokens: false,
} as const;

const emptyWorkflow = { turns: 0, editTurns: 0, subagentCalls: 0 } as const;

const input: DashboardV2Snapshot = {
  generatedAt: "2026-08-10T12:00:00.000Z",
  mode: "real",
  pricingAvailable: false,
  outputAvailability: {
    securityRuns: { count: null, available: false },
    distillationOutputs: { count: null, available: false },
    distillationBreakdown: { capability: null, memory: null },
    dailyReports: { count: null, available: false },
    weeklyReports: { count: null, available: false },
    monthlyReports: { count: null, available: false },
  },
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
        turns: 4,
        editTurns: 1,
        subagentCalls: 3,
      },
    ],
    bySourceDay: [
      {
        source: "codex",
        date: "2026-08-10",
        count: 2,
        turns: 4,
        editTurns: 1,
        subagentCalls: 3,
      },
    ],
  },
  tools: [
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
      available: false,
      detected: false,
      usageSupport: "adapter",
    },
    {
      id: "other",
      name: "Other",
      available: false,
      detected: false,
      usageSupport: "unsupported",
    },
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
        tools: [{ name: "apply_patch", category: "execution", calls: 2 }],
        skillCalls: 0,
        toolOutputCalls: 0,
      },
      evidence: codexEvidence,
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
      evidence: codexEvidence,
    },
  ],
};

test("tool overview uses scan state plus real sanitized event aggregates", () => {
  const view = buildToolOverview(
    input,
    "codex",
    "custom",
    "2026-08-10",
    "2026-08-10",
  );
  assert.deepEqual(
    view.cards.map((card) => card.id),
    ["codex"],
  );
  assert.equal(view.cards[0]?.tokens, 150);
  assert.equal(view.cards[0]?.events, 2);
  assert.equal(view.cards.find((card) => card.id === "codex")?.sessions, 2);
  assert.equal(
    view.cards.find((card) => card.id === "codex")?.subagentCalls,
    3,
  );
  assert.equal(view.cards.find((card) => card.id === "codex")?.cacheRate, 0);
  assert.equal(view.cards.find((card) => card.id === "codex")?.messages, 2);
  assert.equal(view.projects[0]?.sessions, 2);
  assert.equal(view.models[0]?.key, "gpt-test");
  assert.equal(view.projects[0]?.key, APP_ID);
  assert.equal(view.toolCallDetailsAvailable, true);
  assert.deepEqual(view.toolCallDetails, [
    {
      name: "apply_patch",
      category: "execution",
      calls: 2,
      attributedTokens: 100,
    },
  ]);
});

test("tool overview orders cards by usage in the selected period", () => {
  const cursorEvent = {
    ...input.events[0]!,
    source: "cursor" as const,
    inputTokens: 240,
    totalTokens: 300,
  };
  const view = buildToolOverview(
    { ...input, events: [...input.events, cursorEvent] },
    null,
    "custom",
    "2026-08-10",
    "2026-08-10",
  );

  assert.deepEqual(
    view.cards.map((card) => [card.id, card.tokens, card.events]),
    [
      ["cursor", 300, 1],
      ["codex", 150, 2],
    ],
  );
});

test("skill evidence preserves observed zero and unavailable sessions", () => {
  const observed = buildToolOverview(
    input,
    "codex",
    "custom",
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
          usageSupport: "native",
        },
        ...input.tools,
      ],
    },
    "claude-code",
    "custom",
    "2026-08-10",
    "2026-08-10",
  );

  assert.deepEqual(view.selected, {
    id: "claude-code",
    name: "Claude Code",
    icon: "claude",
    color: "#d97757",
    available: false,
    detected: true,
    active: false,
    state: "detected",
    tokens: 0,
    events: 0,
    share: 0,
    sessions: 0,
    subagentCalls: 0,
    cacheRate: null,
    messages: null,
    lastActiveAt: null,
    skillUsage: { observed: false, calls: 0 },
    measurement: "unavailable",
  });
});

test("the first active tool is selected when there is no explicit selection", () => {
  const view = buildToolOverview(
    input,
    null,
    "custom",
    "2026-08-10",
    "2026-08-10",
  );

  assert.equal(view.selected?.id, "codex");
});

test("detail rows retain real priced cost semantics when pricing is available", () => {
  const view = buildToolOverview(
    { ...input, pricingAvailable: true },
    "codex",
    "custom",
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

test("tool card names retain the canonical product labels", () => {
  const view = buildToolOverview(
    {
      ...input,
      tools: input.tools.map((tool) =>
        tool.id === "codex" ? { ...tool, name: "Configured Codex" } : tool,
      ),
    },
    "codex",
    "custom",
    "2026-08-10",
    "2026-08-10",
  );

  assert.equal(view.selected?.name, "Configured Codex");
  assert.equal(
    view.cards.find((card) => card.id === "codex")?.name,
    "Configured Codex",
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
          {
            source: "cursor",
            date: "2026-08-09",
            count: 9,
            ...emptyWorkflow,
          },
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
  assert.equal(view.cards.length, 1);
});

test("tool overview fills natural days and keeps token composition mutually exclusive", () => {
  const reasoningInput: DashboardV2Snapshot = {
    ...input,
    events: [
      {
        ...input.events[0]!,
        inputTokens: 60,
        cachedInputTokens: 20,
        cacheCreationInputTokens: 10,
        outputTokens: 20,
        reasoningOutputTokens: 5,
        totalTokens: 110,
      },
    ],
  };
  const view = buildToolOverview(
    reasoningInput,
    "codex",
    "custom",
    "2026-08-09",
    "2026-08-11",
  );

  assert.deepEqual(view.trend, [
    { date: "2026-08-09", tokens: 0 },
    { date: "2026-08-10", tokens: 110 },
    { date: "2026-08-11", tokens: 0 },
  ]);
  assert.equal(view.naturalDays, 3);
  assert.deepEqual(view.tokenComposition, {
    inputTokens: 60,
    cachedInputTokens: 20,
    cacheCreationInputTokens: 10,
    outputTokens: 15,
    reasoningOutputTokens: 5,
  });
  assert.equal(
    Object.values(view.tokenComposition).reduce((sum, value) => sum + value, 0),
    view.totalTokens,
  );
});

test("Claude tool outputs remain unavailable instead of becoming an observed zero", () => {
  const claudeEvent: DashboardV2Snapshot["events"][number] = {
    ...input.events[0]!,
    source: "claude-code",
    evidence: {
      ...codexEvidence,
      toolOutputCalls: false,
      reasoningTokens: false,
    },
  };
  const view = buildToolOverview(
    {
      ...input,
      tools: [
        ...input.tools,
        {
          id: "claude-code",
          name: "Claude Code",
          available: true,
          detected: true,
          usageSupport: "native",
        },
      ],
      events: [claudeEvent],
    },
    "claude-code",
    "custom",
    "2026-08-10",
    "2026-08-10",
  );

  const outputs = view.context.find((row) => row.key === "toolOutputCalls");
  assert.equal(outputs?.available, false);
  assert.equal(outputs?.count, null);
  assert.equal(view.reasoningAvailable, false);
  assert.deepEqual(view.skillUsage, { observed: true, calls: 0 });
});

test("estimated model-only usage never invents a context breakdown", () => {
  const estimatedEvent: DashboardV2Snapshot["events"][number] = {
    ...input.events[0]!,
    source: "antigravity",
    model: "gemini-2.5-pro",
    measurement: "estimated",
    context: {
      textResponses: 0,
      toolCalls: 0,
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
  };
  const view = buildToolOverview(
    {
      ...input,
      tools: [
        ...input.tools,
        {
          id: "antigravity",
          name: "Antigravity",
          available: true,
          detected: true,
          usageSupport: "unsupported",
        },
      ],
      events: [estimatedEvent],
    },
    "antigravity",
    "custom",
    "2026-08-10",
    "2026-08-10",
  );

  assert.equal(view.selected?.measurement, "estimated");
  assert.equal(view.measurement, "estimated");
  assert.equal(view.cacheRate, null);
  assert.equal(view.hasContextBreakdown, false);
  assert.equal(view.toolCallDetailsAvailable, false);
  assert.equal(view.models[0]?.key, "gemini-2.5-pro");
});

test("tool overview stays within renderer-safe aggregate fields", () => {
  const view = buildToolOverview(
    input,
    "codex",
    "custom",
    "2026-08-10",
    "2026-08-10",
  );
  const serialized = JSON.stringify(view);
  assert.equal(serialized.includes("sessionId"), false);
  assert.equal(serialized.includes("/Users/"), false);
  assert.equal(serialized.includes("raw context"), false);
});
