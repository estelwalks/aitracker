import assert from "node:assert/strict";
import test from "node:test";

import { buildSessionDensity } from "./session-snapshot.contracts.ts";
import { createSessionSnapshotRuntime } from "./session-snapshot-runtime.server.ts";
import { createSnapshotEnvelopeRepository } from "../../../platform/snapshot-runtime/envelope-repository.ts";
import type { AtomicJsonStore } from "../../../platform/persistence/contracts.ts";
import type { SnapshotEnvelope } from "../../../platform/snapshot-runtime/contracts.ts";
import type { SessionSnapshotData } from "./session-snapshot.contracts.ts";
import type { SessionSummary } from "../contracts.ts";

const EMPTY: SnapshotEnvelope<SessionSnapshotData> = {
  schemaVersion: 1,
  revision: "empty",
  generatedAt: null,
  sourceFingerprint: null,
  status: "empty",
  data: null,
  diagnostics: {
    lastAttemptAt: null,
    lastSuccessAt: null,
    warningCodes: [],
  },
};

function session(
  id: string,
  source: string,
  startedAt: string,
  extra: Partial<SessionSummary> = {},
): SessionSummary {
  return {
    sessionId: id,
    source,
    title: `title-${id}`,
    projectKey: "proj",
    model: "claude-opus-4",
    startedAt,
    endedAt: startedAt,
    durationMs: 1000,
    turns: 2,
    editTurns: 1,
    retryTurns: 0,
    totals: {
      inputTokens: 100,
      outputTokens: 50,
      cachedInputTokens: 10,
      cacheCreationInputTokens: 5,
      reasoningOutputTokens: 0,
      totalTokens: 165,
    },
    cost: {
      knownUsd: 0,
      estimatedUsd: 0.01,
      cacheSavingsUsd: 0,
      pricedEvents: 0,
      estimatedEvents: 1,
      unknownEvents: 0,
      unknownModels: [],
      complete: true,
    },
    subagentCalls: 0,
    status: "available",
    statusReason: null,
    resumeAvailable: false,
    ...extra,
  };
}

function memoryStore<T>(initial: T): AtomicJsonStore<T> {
  let value = initial;
  return {
    async read() {
      return {
        value,
        source: value == null ? "default" : "stored",
        schemaVersion: 1,
      };
    },
    async write(next) {
      value = next;
    },
  };
}

test("T3-01: density aggregates sessions by source and day", () => {
  const sessions = [
    session("s1", "claude-code", "2026-08-01T10:00:00Z", {
      turns: 3,
      editTurns: 2,
      subagentCalls: 1,
    }),
    session("s2", "claude-code", "2026-08-01T12:00:00Z"),
    session("s3", "codex", "2026-08-02T09:00:00Z"),
  ];
  const density = buildSessionDensity(sessions);
  assert.equal(density.length, 2);
  const claude = density.find((row) => row.source === "claude-code")!;
  assert.equal(claude.date, "2026-08-01");
  assert.equal(claude.count, 2);
  assert.equal(claude.turns, 5);
  assert.equal(claude.editTurns, 3);
  assert.equal(claude.subagentCalls, 1);
  assert.equal(claude.totalTokens, 330);
  const codex = density.find((row) => row.source === "codex")!;
  assert.equal(codex.count, 1);
});

test("T3-01: runtime refresh commits a snapshot and readLatest is O(1)", async () => {
  const store = memoryStore<SnapshotEnvelope<SessionSnapshotData>>(
    null as never,
  );
  const repository = createSnapshotEnvelopeRepository({
    store,
    emptyEnvelope: EMPTY,
    schema: { currentVersion: 1, parse: (value: unknown) => value as never },
  });
  let collectCalls = 0;
  const runtime = createSessionSnapshotRuntime({
    repository,
    now: () => Date.parse("2026-08-01T00:10:00.000Z"),
    collect: async () => {
      collectCalls += 1;
      const sessions = [session("s1", "claude-code", "2026-08-01T10:00:00Z")];
      return {
        data: {
          generatedAt: "t",
          sessions,
          density: buildSessionDensity(sessions),
        },
      };
    },
  });
  await Promise.all([
    runtime.refreshNow(),
    runtime.refreshNow(),
    runtime.refreshNow(),
  ]);
  assert.equal(collectCalls, 1); // single-flight
  const latest = runtime.readLatest();
  assert.equal(latest.status, "fresh");
  assert.equal(latest.data?.sessions.length, 1);
  assert.equal(latest.data?.density.length, 1);
  assert.ok(latest.revision);
});

test("T3-01: collector failure keeps last-known-good", async () => {
  const store = memoryStore<SnapshotEnvelope<SessionSnapshotData>>(
    null as never,
  );
  const repository = createSnapshotEnvelopeRepository({
    store,
    emptyEnvelope: EMPTY,
    schema: { currentVersion: 1, parse: (value: unknown) => value as never },
  });
  const runtime = createSessionSnapshotRuntime({
    repository,
    now: () => Date.parse("2026-08-01T00:10:00.000Z"),
    collect: async () => {
      throw new Error("scanner exploded");
    },
  });
  await runtime.refreshNow();
  const latest = runtime.readLatest();
  assert.equal(latest.data, null);
  assert.ok(latest.warningCodes.includes("collection-failed"));
});

test("T3-01: stale snapshot stays readable", async () => {
  const store = memoryStore<SnapshotEnvelope<SessionSnapshotData>>({
    schemaVersion: 1,
    revision: "r1",
    generatedAt: "2026-07-30T00:00:00.000Z",
    sourceFingerprint: null,
    status: "fresh",
    data: {
      generatedAt: "2026-07-30T00:00:00.000Z",
      sessions: [session("s1", "claude-code", "2026-07-30T10:00:00Z")],
      density: [],
    },
    diagnostics: {
      lastAttemptAt: "2026-07-30T00:00:00.000Z",
      lastSuccessAt: "2026-07-30T00:00:00.000Z",
      warningCodes: [],
    },
  } satisfies SnapshotEnvelope<SessionSnapshotData>);
  const repository = createSnapshotEnvelopeRepository({
    store,
    emptyEnvelope: EMPTY,
    schema: { currentVersion: 1, parse: (value: unknown) => value as never },
  });
  const runtime = createSessionSnapshotRuntime({
    repository,
    now: () => Date.parse("2026-08-01T00:10:00.000Z"),
    collect: async () => ({
      data: { generatedAt: "t", sessions: [], density: [] },
    }),
  });
  await runtime.ensureHydrated();
  const latest = runtime.readLatest();
  assert.equal(latest.status, "stale");
  assert.equal(latest.data?.sessions.length, 1);
});
