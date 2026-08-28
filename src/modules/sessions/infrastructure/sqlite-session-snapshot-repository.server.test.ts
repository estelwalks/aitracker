import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DatabaseHost } from "../../../platform/database/database-host.server.ts";
import { runMigrations } from "../../../platform/database/migration-runner.server.ts";
import type { SnapshotEnvelope } from "../../../platform/snapshot-runtime/contracts.ts";
import type { SessionSummary } from "../contracts.ts";
import type { SessionSnapshotData } from "./session-snapshot.contracts.ts";
import { createSqliteSessionSnapshotRepository } from "./sqlite-session-snapshot-repository.server.ts";

function openHost(directory: string): DatabaseHost {
  const host = DatabaseHost.open({
    path: join(directory, "platform.db"),
    versionsProvider: {
      getVersions: () => ({ nodeVersion: "24.19.0", sqliteVersion: "99.0.0" }),
    },
  });
  runMigrations({ database: host, appVersion: "test" });
  return host;
}

const session = (
  id: string,
  source: string,
  startedAt: string,
  unknownModels: readonly string[] = [],
): SessionSummary => ({
  sessionId: id,
  source,
  title: `title-${id}`,
  projectKey: "proj",
  model: "model-a",
  startedAt,
  endedAt: startedAt,
  durationMs: 1000,
  turns: 2,
  editTurns: 0,
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
    unknownModels,
    complete: true,
  },
  subagentCalls: 0,
  status: "available",
  statusReason: null,
  resumeAvailable: false,
});

function envelope(
  sessions: readonly SessionSummary[],
): SnapshotEnvelope<SessionSnapshotData> {
  return {
    schemaVersion: 1,
    revision: "rev-1",
    generatedAt: "2026-08-07T00:00:00.000Z",
    sourceFingerprint: "sessions-v7",
    status: "fresh",
    data: {
      collectorVersion: "sessions-v7",
      generatedAt: "2026-08-07T00:00:00.000Z",
      sessions,
      density: [],
    },
    diagnostics: {
      lastAttemptAt: null,
      lastSuccessAt: null,
      warningCodes: [],
    },
  };
}

test("P1-11: load() assembles unknown models from a single batch instead of per-session queries", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "aitracker-session-repo-unknown-"),
  );
  try {
    const host = openHost(directory);
    const repository = createSqliteSessionSnapshotRepository({
      database: host,
      hmacKey: "test-key",
    });
    await repository.save(
      envelope([
        session("s1", "codex", "2026-08-07T00:01:00.000Z", [
          "model-x",
          "model-y",
        ]),
        session("s2", "claude", "2026-08-07T00:02:00.000Z", []),
      ]),
    );

    const loaded = await repository.load();
    assert.equal(loaded.envelope.data?.sessions.length, 2);
    const byId = new Map(
      loaded.envelope.data!.sessions.map((item) => [item.sessionId, item]),
    );
    assert.deepEqual(byId.get("s1")?.cost.unknownModels, [
      "model-x",
      "model-y",
    ]);
    assert.deepEqual(byId.get("s2")?.cost.unknownModels, []);
    host.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("P1-11: load({ limit, offset }) pages at the SQL layer and defaults to the full snapshot", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "aitracker-session-repo-paging-"),
  );
  try {
    const host = openHost(directory);
    const repository = createSqliteSessionSnapshotRepository({
      database: host,
      hmacKey: "test-key",
    });
    // ORDER BY started_at_ms DESC → newest first.
    await repository.save(
      envelope([
        session("oldest", "codex", "2026-08-07T00:01:00.000Z"),
        session("middle", "codex", "2026-08-07T00:02:00.000Z"),
        session("newest", "codex", "2026-08-07T00:03:00.000Z"),
      ]),
    );

    const full = await repository.load();
    assert.equal(full.envelope.data?.sessions.length, 3);

    const page = await repository.load({ limit: 2 });
    assert.equal(page.envelope.data?.sessions.length, 2);
    assert.deepEqual(
      page.envelope.data!.sessions.map((item) => item.sessionId),
      ["newest", "middle"],
    );

    const offset = await repository.load({ limit: 1, offset: 2 });
    assert.deepEqual(
      offset.envelope.data!.sessions.map((item) => item.sessionId),
      ["oldest"],
    );

    // Offset alone pages from the start of the ordered set.
    const offsetOnly = await repository.load({ offset: 1 });
    assert.deepEqual(
      offsetOnly.envelope.data!.sessions.map((item) => item.sessionId),
      ["middle", "oldest"],
    );
    host.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
