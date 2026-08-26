import assert from "node:assert/strict";
import test from "node:test";
import {
  createSnapshotSessionRepository,
  type SessionSnapshotReader,
} from "./snapshot-session-repository.ts";
import type { SessionSnapshotData } from "./session-snapshot.contracts.ts";
import type { SessionSummary } from "../contracts.ts";

function summary(id: string): SessionSummary {
  return {
    sessionId: id,
    source: "claude-code",
    title: `session ${id}`,
    projectKey: "project",
    model: null,
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T01:00:00.000Z",
    durationMs: 3_600_000,
    turns: 2,
    editTurns: 0,
    retryTurns: 0,
    totals: {
      inputTokens: 10,
      outputTokens: 5,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 15,
    },
    cost: {
      knownUsd: 0,
      estimatedUsd: 0,
      cacheSavingsUsd: 0,
      pricedEvents: 0,
      estimatedEvents: 0,
      unknownEvents: 0,
      unknownModels: [],
      complete: false,
    },
    subagentCalls: 0,
    status: "available",
    statusReason: null,
    resumeAvailable: false,
  };
}

function readerWith(
  data: SessionSnapshotData | null,
  refresh = async () => {},
  status: "fresh" | "stale" = "fresh",
): SessionSnapshotReader & { refreshCalls: number } {
  const state = {
    data,
    hydrated: false,
    refreshCalls: 0,
  };
  return {
    get refreshCalls() {
      return state.refreshCalls;
    },
    async ensureHydrated() {
      state.hydrated = true;
    },
    readLatest() {
      return {
        data: state.data,
        status: state.data == null ? ("empty" as const) : status,
        revision: state.data == null ? null : "rev-1",
        generatedAt: state.data?.generatedAt ?? null,
      };
    },
    async refreshNow() {
      state.refreshCalls += 1;
      return refresh();
    },
    // P3-T3-11: empty-state refreshes route through the unified task runtime.
    async requestRefresh() {
      state.refreshCalls += 1;
      return refresh();
    },
  };
}

test("returns the snapshot session index without scanning", async () => {
  const data: SessionSnapshotData = {
    generatedAt: "2026-01-01T00:00:00.000Z",
    sessions: [summary("a"), summary("b")],
    density: [],
  };
  const reader = readerWith(data);
  const repository = createSnapshotSessionRepository(reader);
  const sessions = await repository.list();
  assert.deepEqual(
    sessions.map((session) => session.sessionId),
    ["a", "b"],
  );
  assert.equal(reader.refreshCalls, 0);
});

test("strips the server-only projectRef before summaries cross the query boundary", async () => {
  const data: SessionSnapshotData = {
    generatedAt: "2026-01-01T00:00:00.000Z",
    sessions: [
      { ...summary("a"), projectRef: "/private/work/project-a" },
      { ...summary("b") },
    ],
    density: [],
  };
  const reader = readerWith(data);
  const repository = createSnapshotSessionRepository(reader);
  const sessions = await repository.list();
  assert.equal("projectRef" in sessions[0]!, false);
  assert.equal(JSON.stringify(sessions).includes("/private/work"), false);
  assert.equal(sessions[0]?.projectKey, "project");
});

test("empty snapshot returns an empty list and refreshes in the background", async () => {
  const reader = readerWith(null);
  const repository = createSnapshotSessionRepository(reader);
  const sessions = await repository.list();
  assert.deepEqual(sessions, []);
  assert.equal(reader.refreshCalls, 1);
});

test("stale snapshot remains readable and schedules a refresh", async () => {
  const reader = readerWith(
    {
      generatedAt: "2026-01-01T00:00:00.000Z",
      sessions: [summary("a")],
      density: [],
    },
    async () => {},
    "stale",
  );
  const repository = createSnapshotSessionRepository(reader);
  const sessions = await repository.list();
  assert.deepEqual(
    sessions.map((session) => session.sessionId),
    ["a"],
  );
  assert.equal(reader.refreshCalls, 1);
});

test("hides AiPy zero-token placeholders", async () => {
  const base = summary("placeholder");
  const aipy = {
    ...base,
    sessionId: "aipy-zero",
    source: "aipy" as const,
    totals: {
      ...base.totals,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    },
  };
  const repository = createSnapshotSessionRepository(
    readerWith({
      generatedAt: "2026-01-01T00:00:00.000Z",
      sessions: [aipy],
      density: [],
    }),
  );
  assert.deepEqual(
    (await repository.list()).map((session) => session.sessionId),
    [],
  );
});

test("aborted signal returns without reading or refreshing", async () => {
  const reader = readerWith(null);
  const controller = new AbortController();
  controller.abort();
  const repository = createSnapshotSessionRepository(reader);
  const sessions = await repository.list(controller.signal);
  assert.deepEqual(sessions, []);
  assert.equal(reader.refreshCalls, 0);
});
