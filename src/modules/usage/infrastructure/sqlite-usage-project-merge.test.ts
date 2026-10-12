import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildLocalUsageSnapshot } from "../../../lib/local-usage/aggregate.ts";
import { createSqliteClassificationIndexRepository } from "../../dashboard/sqlite-classification-index.server.ts";
import { DatabaseHost } from "../../../platform/database/database-host.server.ts";
import { runMigrations } from "../../../platform/database/migration-runner.server.ts";
import { createSqliteProjectIdentityMergeRepository } from "../../../platform/database/project-identity-merge-repository.server.ts";
import { hashSensitiveRef } from "../../../platform/database/snapshot-generation.server.ts";
import type { SnapshotEnvelope } from "../../../platform/snapshot-runtime/contracts.ts";
import { createSqliteUsageSnapshotRepository } from "./sqlite-usage-snapshot-repository.server.ts";

function openDatabase(t: { after(fn: () => void): void }): DatabaseHost {
  const directory = mkdtempSync(join(tmpdir(), "aitracker-usage-merges-"));
  const host = DatabaseHost.open({
    path: join(directory, "platform.db"),
    versionsProvider: {
      getVersions: () => ({ nodeVersion: "24.19.0", sqliteVersion: "99.0.0" }),
    },
  });
  runMigrations({ database: host, appVersion: "test" });
  t.after(() => host.close());
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return host;
}

function envelope<T>(data: T): SnapshotEnvelope<T> {
  return {
    schemaVersion: 1,
    revision: "merge-test",
    generatedAt: "2026-09-23T00:00:00.000Z",
    sourceFingerprint: "merge-test",
    status: "fresh",
    data,
    diagnostics: {
      lastAttemptAt: "2026-09-23T00:00:00.000Z",
      lastSuccessAt: "2026-09-23T00:00:00.000Z",
      warningCodes: [],
    },
  };
}

test("usage projections apply opaque project merges on save and load", async (t) => {
  const database = openDatabase(t);
  const hmacKey = "usage-merge-test-key";
  const root = "/Users/alice/sports_analyze";
  const nested = `${root}/backend`;
  const rootIdentity = hashSensitiveRef(hmacKey, "project", root);
  const nestedIdentity = hashSensitiveRef(hmacKey, "project", nested);
  const merges = createSqliteProjectIdentityMergeRepository(database);
  merges.merge(nestedIdentity, rootIdentity);

  await createSqliteClassificationIndexRepository({ database, hmacKey }).commit(
    [
      {
        ref: root,
        kind: "workspace",
        label: "sports_analyze",
        classifiedAt: "2026-09-23T00:00:00.000Z",
        fingerprint: null,
      },
      {
        ref: nested,
        kind: "workspace",
        label: "sports_analyze",
        classifiedAt: "2026-09-23T00:00:00.000Z",
        fingerprint: null,
      },
    ],
  );

  const raw = buildLocalUsageSnapshot(
    [root, nested].map((project, index) => ({
      source: "claude-code" as const,
      timestamp: `2026-09-23T00:0${index}:00.000Z`,
      model: "claude-test",
      project,
      sessionId: `session-${index}`,
      inputTokens: 10,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      outputTokens: 5,
      reasoningOutputTokens: 0,
      totalTokens: 15,
      context: {},
    })),
    [],
    new Date("2026-09-23T01:00:00.000Z"),
  );
  const repository = createSqliteUsageSnapshotRepository({
    database,
    hmacKey,
    resolveProjectIdentity: merges.resolve,
    createId: () => "usage-merge-snapshot",
  });
  await repository.save(envelope(raw));

  const hydrated = await repository.load();
  assert.equal(hydrated.envelope.data?.byProject.length, 1);
  assert.equal(hydrated.envelope.data?.byProject[0]?.totalTokens, 30);
  assert.equal(
    hydrated.envelope.data?.aggregateBuckets?.every(
      (bucket) => bucket.projectRefHash === rootIdentity,
    ),
    true,
  );
  assert.equal(
    hydrated.envelope.data?.trackerBuckets?.every(
      (bucket) =>
        bucket.dimension !== "project" || bucket.identity === rootIdentity,
    ),
    true,
  );
  const trackerRow = database
    .prepare(
      "SELECT COUNT(*) AS count, SUM(event_count) AS events FROM usage_tracker_buckets WHERE dimension='project' AND entity_key=?",
    )
    .get(rootIdentity);
  assert.equal(Number(trackerRow?.count), 1);
  assert.equal(Number(trackerRow?.events), 2);
});
