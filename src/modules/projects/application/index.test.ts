import assert from "node:assert/strict";
import test from "node:test";
import type { LocalUsageEvent } from "../../../lib/local-usage/types";
import type { SessionRecord } from "../../../lib/local-sessions/types";
import { createProjectUsageReadModel } from "./index";

const event = (
  project: string,
  overrides: Partial<LocalUsageEvent> = {},
): LocalUsageEvent => ({
  source: "codex",
  timestamp: "2026-08-07T00:00:00.000Z",
  model: "demo-model",
  project,
  inputTokens: 10,
  cachedInputTokens: 0,
  cacheCreationInputTokens: 0,
  outputTokens: 5,
  reasoningOutputTokens: 0,
  totalTokens: 15,
  ...overrides,
});

const session = (
  projectRef: string,
  overrides: Partial<SessionRecord> = {},
): SessionRecord => ({
  sessionId: "session-1",
  source: "codex",
  title: "Demo",
  projectKey: "Demo",
  projectRef,
  model: "demo-model",
  startedAt: "2026-08-07T00:00:00.000Z",
  endedAt: "2026-08-07T00:01:00.000Z",
  durationMs: 60_000,
  turns: 1,
  editTurns: 0,
  retryTurns: 0,
  totals: {
    inputTokens: 2,
    outputTokens: 3,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 5,
  },
  cost: {
    knownUsd: 1,
    estimatedUsd: 0,
    cacheSavingsUsd: 0,
    pricedEvents: 1,
    estimatedEvents: 0,
    unknownEvents: 0,
    unknownModels: [],
    complete: true,
  },
  subagentCalls: 0,
  status: "available",
  statusReason: null,
  resumeSafe: true,
  resumeCommand: "codex resume session-1",
  ...overrides,
});

const pricing = {
  estimateEventCost: () => ({
    knownUsd: 2,
    estimatedUsd: 0,
    cacheSavingsUsd: 0,
    pricedEvents: 1,
    estimatedEvents: 0,
    unknownEvents: 0,
    unknownModels: [],
    complete: true,
  }),
};

test("normalizes separators but keeps same-name projects at different paths separate", () => {
  const model = createProjectUsageReadModel(
    { events: [event("/work/demo"), event("\\work\\demo")] },
    pricing,
  );
  assert.equal(model.projects.length, 1);
  assert.equal(model.projects[0]?.tokens.totalTokens, 30);
  const distinct = createProjectUsageReadModel(
    { events: [event("/a/demo"), event("/b/demo")] },
    pricing,
  );
  assert.equal(distinct.projects.length, 2);
});

test("windows identity is case-insensitive", () => {
  const model = createProjectUsageReadModel(
    { events: [event("C:\\Work\\Demo"), event("c:/work/demo/")] },
    pricing,
    "windows",
  );
  assert.equal(model.projects.length, 1);
});

test("missing project is retained in a stable unknown bucket", () => {
  const model = createProjectUsageReadModel(
    { events: [event(""), event("   ")] },
    pricing,
  );
  assert.equal(model.projects[0]?.id, "project:unknown");
  assert.equal(model.projects[0]?.eventCount, 2);
  assert.equal(model.unknownProjectId, "project:unknown");
});

test("unknown pricing remains unknown, never an exact zero", () => {
  const model = createProjectUsageReadModel(
    { events: [event("/work/demo")] },
    {
      estimateEventCost: () => ({
        knownUsd: 0,
        estimatedUsd: 0,
        cacheSavingsUsd: 0,
        pricedEvents: 0,
        estimatedEvents: 0,
        unknownEvents: 1,
        unknownModels: ["secret-model"],
        complete: false,
      }),
    },
  );
  assert.equal(model.projects[0]?.cost.unknownEvents, 1);
  assert.equal(model.projects[0]?.cost.complete, false);
});

test("session count and cost are included without double-counting a matched event", () => {
  const model = createProjectUsageReadModel(
    {
      events: [event("/work/demo", { sessionId: "session-1" })],
      sessions: [session("/work/demo")],
    },
    pricing,
  );
  assert.equal(model.projects[0]?.sessionCount, 1);
  assert.equal(model.projects[0]?.tokens.totalTokens, 15);
  assert.equal(model.projects[0]?.cost.knownUsd, 2);
});

test("empty input returns an empty read model", () => {
  const model = createProjectUsageReadModel({}, pricing, "posix");
  assert.deepEqual(model.projects, []);
  assert.equal(typeof model.generatedAt, "string");
});
