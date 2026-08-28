import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DatabaseHost } from "../../../platform/database/database-host.server.ts";
import { runMigrations } from "../../../platform/database/migration-runner.server.ts";
import { createSqliteInsightRepository } from "../infrastructure/sqlite-insight-repository.server.ts";
import type { PageInsightsApplication } from "./application.ts";
import type {
  InsightEnvelope,
  InsightEnvelopeStatus,
  InsightSurfaceId,
} from "./contracts.ts";
import { createInsightRefreshBatchService } from "./background-refresh.server.ts";

function fixture(t: { after(fn: () => void): void }) {
  const directory = mkdtempSync(join(tmpdir(), "aitracker-insight-batch-"));
  const host = DatabaseHost.open({
    path: join(directory, "platform.db"),
    versionsProvider: {
      getVersions: () => ({ nodeVersion: "24.19.0", sqliteVersion: "99.0.0" }),
    },
  });
  runMigrations({ database: host, appVersion: "test" });
  t.after(() => host.close());
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return createSqliteInsightRepository(host);
}

function envelope(
  surfaceId: InsightSurfaceId,
  status: InsightEnvelopeStatus,
): InsightEnvelope {
  return {
    surfaceId,
    status,
    lines: [],
    generatedAt: "2026-08-27T00:00:00.000Z",
    source:
      status === "enhanced-ready" || status === "enhanced-cached"
        ? "enhanced"
        : "rules",
    canEnhance: true,
    autoEnhance: true,
  };
}

test("starting a batch generates every eligible surface without a page mount", async (t) => {
  const store = fixture(t);
  const calls: InsightSurfaceId[] = [];
  const reasons: string[] = [];
  const application: PageInsightsApplication = {
    read: async (surfaceId) => envelope(surfaceId, "rules"),
    enhance: async (surfaceId, _scope, options) => {
      calls.push(surfaceId);
      reasons.push(options.reason);
      return envelope(
        surfaceId,
        surfaceId === "security"
          ? "no-eligible-candidates"
          : surfaceId === "tracker"
            ? "timeout"
            : "enhanced-ready",
      );
    },
  };
  const scheduled: Array<() => void | Promise<void>> = [];
  const service = createInsightRefreshBatchService({
    application,
    store,
    items: [
      { surfaceId: "dashboard", scopeJson: "{}" },
      { surfaceId: "security", scopeJson: "{}" },
      { surfaceId: "tracker", scopeJson: "{}" },
    ],
    createId: () => "batch-one",
    now: (() => {
      let now = 1_000;
      return () => now++;
    })(),
    schedule: (work) => scheduled.push(work),
  });

  const [first, duplicate] = await Promise.all([
    service.start("zh-CN"),
    service.start("zh-CN"),
  ]);
  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.run.runId, first.run.runId);
  assert.equal(scheduled.length, 1, "one active run has one background worker");
  assert.deepEqual(calls, [], "start returns before model generation begins");

  await scheduled[0]!();

  // Items are processed concurrently; only the set of surfaces is stable.
  assert.deepEqual([...calls].sort(), ["dashboard", "security", "tracker"]);
  assert.deepEqual(reasons, ["batch", "batch", "batch"]);
  const view = service.get("batch-one");
  assert.ok(view);
  const { items, ...run } = view;
  assert.deepEqual(run, {
    runId: "batch-one",
    locale: "zh-CN",
    generation: 1,
    status: "completed",
    total: 3,
    completed: 1,
    failed: 1,
    skipped: 1,
    createdAtMs: 1_000,
    startedAtMs: 1_002,
    finishedAtMs: 1_007,
  });
  assert.equal(items.length, 3);
  assert.deepEqual(items.map((item) => item.status).sort(), [
    "completed",
    "failed",
    "skipped",
  ]);
  assert.ok(
    items.every((item) => item.resultDetail === null),
    "no failure detail on non-failed fixtures",
  );
});
