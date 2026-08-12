import assert from "node:assert/strict";
import test from "node:test";

import { isErr, isOk } from "../../../shared/result.ts";
import type { SessionSummary } from "../contracts.ts";
import { createSessionQueryService } from "./index.ts";

const session = (
  id: string,
  startedAt: string,
  overrides: Partial<SessionSummary> = {},
): SessionSummary => ({
  sessionId: id,
  source: "codex",
  title: id,
  projectKey: "demo",
  model: "model-a",
  startedAt,
  endedAt: startedAt,
  durationMs: 100,
  turns: 1,
  editTurns: 0,
  retryTurns: 0,
  totals: {
    inputTokens: 1,
    outputTokens: 2,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 3,
  },
  cost: {
    knownUsd: 0,
    estimatedUsd: 0,
    cacheSavingsUsd: 0,
    pricedEvents: 0,
    estimatedEvents: 0,
    unknownEvents: 0,
    unknownModels: [],
    complete: true,
  },
  subagentCalls: 0,
  status: "available",
  statusReason: null,
  resumeAvailable: true,
  ...overrides,
});

test("filters, sorts and paginates sessions", async () => {
  const repository = {
    list: async () => [
      session("old", "2020-01-01T00:00:00.000Z"),
      session("new", new Date().toISOString(), { projectKey: "prod" }),
    ],
  };
  const result = await createSessionQueryService(repository).query({
    filter: { projectId: "prod" },
    pageSize: 1,
  });
  assert.equal(isOk(result), true);
  if (isOk(result)) {
    assert.equal(result.value.total, 1);
    assert.equal(result.value.sessions[0]?.sessionId, "new");
  }
});

test("finds a session by its opaque public id when no display field matches", async () => {
  const result = await createSessionQueryService({
    list: async () => [
      session("safe-session-id", new Date().toISOString(), {
        title: "Untitled work",
        projectKey: "project-a",
        model: null,
      }),
    ],
  }).query({ filter: { keyword: "safe-session-id" } });

  assert.equal(isOk(result), true);
  if (isOk(result)) {
    assert.equal(result.value.total, 1);
    assert.equal(result.value.sessions[0]?.sessionId, "safe-session-id");
  }
});

test("cancelled query returns a stable error code", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await createSessionQueryService({
    list: async () => [],
  }).query({ signal: controller.signal });
  assert.equal(isErr(result), true);
  if (isErr(result))
    assert.equal(result.error.code, "errors.sessions.resumeCancelled");
});
