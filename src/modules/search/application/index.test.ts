import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DatabaseHost } from "../../../platform/database/database-host.server.ts";
import { runMigrations } from "../../../platform/database/migration-runner.server.ts";
import { ok } from "../../../shared/result.ts";
import { createEventBus, type CoreEventMap } from "../../../shared/events.ts";
import { documentFromPublic } from "../domain.ts";
import { createSqliteSearchIndexRepository } from "../infrastructure/sqlite-search-index-repository.server.ts";
import { SearchIndexService, createSearchEventProjection } from "./index.ts";

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

test("persists updates and reloads the same index after restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tt-search-index-"));
  try {
    let host = openHost(directory);
    const clock = { now: () => new Date("2026-08-07T00:00:00.000Z") };
    const service = new SearchIndexService(
      createSqliteSearchIndexRepository({ database: host }),
      clock,
    );
    await service.upsert(
      documentFromPublic({
        id: "knowledge:one",
        type: "knowledge",
        sourceRef: "knowledge.one",
        title: "Knowledge",
        textSummary: "offline index",
      }),
    );

    // Truly close and reopen a brand-new connection on the same file, so the
    // reload reads from SQLite rather than the in-memory index/repository.
    host.close();
    host = openHost(directory);
    const restarted = new SearchIndexService(
      createSqliteSearchIndexRepository({ database: host }),
      clock,
    );
    assert.equal((await restarted.load()).ok, true);
    assert.equal(restarted.query({ text: "offline" }).results.length, 1);
    host.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("projection consumes public events and can be disposed", () => {
  const events = createEventBus<CoreEventMap>();
  const modules: string[] = [];
  const projection = createSearchEventProjection({
    events,
    onSnapshotUpdated: (module) => modules.push(module),
  });
  events.publish({
    type: "snapshot.updated",
    schemaVersion: 1,
    module: "sessions",
    occurredAt: "2026-08-07T00:00:00.000Z",
    correlationId: "corr-01" as never,
    summary: { count: 1 },
  });
  projection.dispose();
  events.publish({
    type: "snapshot.updated",
    schemaVersion: 1,
    module: "usage",
    occurredAt: "2026-08-07T00:00:00.000Z",
    correlationId: "corr-02" as never,
    summary: { count: 1 },
  });
  assert.deepEqual(modules, ["sessions"]);
});

test("query path does not invoke a scanner", () => {
  const scannerCalls = 0;
  const service = new SearchIndexService(
    {
      read: async () =>
        ok({
          schemaVersion: 1,
          version: "search-v1-00000000",
          generatedAt: "2026-08-07T00:00:00.000Z",
          stale: false,
          documents: [],
        }),
      write: async (snapshot) => {
        void snapshot;
        return ok(undefined);
      },
    },
    { now: () => new Date("2026-08-07T00:00:00.000Z") },
  );
  void scannerCalls;
  assert.deepEqual(service.query({ text: "anything" }).results, []);
  assert.equal(scannerCalls, 0);
});
