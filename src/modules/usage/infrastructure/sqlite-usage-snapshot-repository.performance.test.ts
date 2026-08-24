import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { buildLocalUsageSnapshot } from "../../../lib/local-usage/aggregate.ts";
import type { LocalUsageEvent } from "../../../lib/local-usage/types.ts";
import type { SqliteDatabasePort } from "../../../platform/database/contracts.ts";
import { DatabaseHost } from "../../../platform/database/database-host.server.ts";
import { runMigrations } from "../../../platform/database/migration-runner.server.ts";
import type { SnapshotEnvelope } from "../../../platform/snapshot-runtime/contracts.ts";
import { createSqliteUsageSnapshotRepository } from "./sqlite-usage-snapshot-repository.server.ts";

const EVENT_COUNT = 60_000;

function envelope<T>(data: T): SnapshotEnvelope<T> {
  return {
    schemaVersion: 1,
    revision: "usage-performance-r1",
    generatedAt: "2026-08-24T08:00:00.000Z",
    sourceFingerprint: "usage-performance-fingerprint",
    status: "fresh",
    data,
    diagnostics: {
      lastAttemptAt: "2026-08-24T08:00:00.000Z",
      lastSuccessAt: "2026-08-24T08:00:00.000Z",
      warningCodes: [],
    },
  };
}

function withSelectCounter(database: SqliteDatabasePort): {
  readonly database: SqliteDatabasePort;
  readonly count: () => number;
  readonly reset: () => void;
} {
  let selects = 0;
  return {
    database: {
      get isOpen() {
        return database.isOpen;
      },
      prepare(sql) {
        if (/^\s*SELECT\b/iu.test(sql)) selects += 1;
        return database.prepare(sql);
      },
      exec: (sql) => database.exec(sql),
      transaction: () => database.transaction(),
      close: () => database.close(),
    },
    count: () => selects,
    reset: () => {
      selects = 0;
    },
  };
}

function usageEvent(sequence: number): LocalUsageEvent {
  return {
    source: sequence % 2 === 0 ? "codex" : "claude-code",
    timestamp: new Date(
      Date.parse("2026-08-24T08:00:00.000Z") - sequence * 60_000,
    ).toISOString(),
    model: sequence % 3 === 0 ? "gpt-test" : "claude-test",
    project: `/private/work/project-${sequence % 5}`,
    sessionId: `session-${sequence % 20}`,
    measurement: "observed",
    inputTokens: 10 + sequence,
    cachedInputTokens: sequence % 7,
    cacheCreationInputTokens: sequence % 5,
    outputTokens: 4 + (sequence % 11),
    reasoningOutputTokens: sequence % 3,
    totalTokens: 14 + sequence + (sequence % 7) + (sequence % 5),
    context: {
      textResponse: true,
      tools: [{ name: "Read", category: "execution", calls: 1 }],
      skills: [{ name: "test-skill", calls: 1 }],
      commands: [
        {
          kind: "exec_command",
          executable: "/bin/test",
          safeSignature: "test:run",
          duration: "under-1s",
          outputSize: "under-1k",
          exitStatus: "success",
          calls: 1,
        },
      ],
      toolOutputs: { characters: 120, lines: 3, completed: true, calls: 1 },
    },
  };
}

test("usage cold hydration uses a fixed number of SELECTs and preserves aggregates", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "tt-usage-hydrate-"));
  const host = DatabaseHost.open({
    path: join(directory, "platform.db"),
    versionsProvider: {
      getVersions: () => ({ nodeVersion: "24.19.0", sqliteVersion: "99.0.0" }),
    },
  });
  t.after(() => host.close());
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  runMigrations({ database: host, appVersion: "usage-performance-test" });

  const counter = withSelectCounter(host);
  const repository = createSqliteUsageSnapshotRepository({
    database: counter.database,
    hmacKey: "usage-performance-test-key",
    createId: () => "usage-performance-snapshot",
  });
  const events = Array.from({ length: EVENT_COUNT }, (_, index) =>
    usageEvent(index),
  );
  const snapshot = buildLocalUsageSnapshot(
    events,
    [
      {
        source: "codex",
        available: true,
        filesConsidered: 1,
        filesRead: 1,
        filesReused: 0,
        filesParsed: 1,
        malformedLines: 0,
        events: EVENT_COUNT / 2,
      },
      {
        source: "claude-code",
        available: true,
        filesConsidered: 1,
        filesRead: 1,
        filesReused: 0,
        filesParsed: 1,
        malformedLines: 0,
        events: EVENT_COUNT / 2,
        diagnostics: [
          {
            code: "malformed-json",
            source: "claude-code",
            count: 2,
            message: "usage.malformed-json",
          },
        ],
      },
    ],
    new Date("2026-08-24T08:00:00.000Z"),
  );
  await repository.save(envelope(snapshot));

  counter.reset();
  const startedAt = performance.now();
  const loaded = await repository.load();
  const durationMs = performance.now() - startedAt;

  t.diagnostic(
    `${EVENT_COUNT.toLocaleString()} raw events -> ${loaded.envelope.data?.aggregateBuckets?.length ?? 0} buckets; hydrate ${durationMs.toFixed(1)}ms with ${counter.count()} SELECTs`,
  );

  assert.ok(
    counter.count() <= 9,
    `hydration must be O(1), observed ${counter.count()} SELECT statements`,
  );
  assert.ok(
    durationMs < 2_000,
    `${EVENT_COUNT.toLocaleString()}-event hydration took ${durationMs.toFixed(1)}ms`,
  );
  assert.equal(loaded.envelope.revision, "usage-performance-r1");
  assert.equal(loaded.envelope.data?.events, snapshot.events);
  assert.deepEqual(loaded.envelope.data?.totals, snapshot.totals);
  assert.deepEqual(loaded.envelope.data?.bySource, snapshot.bySource);
  assert.deepEqual(loaded.envelope.data?.byModel, snapshot.byModel);
  assert.equal(
    loaded.envelope.data?.byProject.length,
    snapshot.byProject.length,
  );
  assert.deepEqual(
    loaded.envelope.data?.daily.map(({ bySource: _bySource, ...day }) => day),
    snapshot.daily.map(({ bySource: _bySource, ...day }) => day),
  );
  for (const day of snapshot.daily) {
    for (const [source, counts] of Object.entries(day.bySource)) {
      if (counts.totalTokens === 0) continue;
      assert.deepEqual(
        loaded.envelope.data?.daily.find((row) => row.date === day.date)
          ?.bySource[source],
        counts,
      );
    }
  }
  assert.equal(loaded.envelope.data?.details.length, 0);
  assert.ok((loaded.envelope.data?.aggregateBuckets?.length ?? 0) < 2_000);
  const codexBucket = loaded.envelope.data?.aggregateBuckets?.find(
    (bucket) => bucket.source === "codex",
  );
  assert.ok(codexBucket);
  assert.ok(codexBucket.events > 1);
  assert.ok(codexBucket.context.toolCalls > 1);
  assert.deepEqual(codexBucket.context.tools, [
    { name: "Read", category: "execution", calls: codexBucket.events },
  ]);
});
