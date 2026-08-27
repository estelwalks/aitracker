import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { SecurityScanRunRecord } from "../../../../electron/contracts.ts";
import { DatabaseHost } from "../../../platform/database/database-host.server.ts";
import { runMigrations } from "../../../platform/database/migration-runner.server.ts";
import { createSqliteSecurityScanRunRepository } from "./sqlite-scan-run-repository.server.ts";

function repositoryFixture(t: { after(fn: () => void): void }) {
  const directory = mkdtempSync(join(tmpdir(), "aitracker-security-runs-"));
  const host = DatabaseHost.open({
    path: join(directory, "platform.db"),
    versionsProvider: {
      getVersions: () => ({
        nodeVersion: "24.19.0",
        sqliteVersion: "99.0.0",
      }),
    },
  });
  runMigrations({ database: host, appVersion: "test" });
  t.after(() => host.close());
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return createSqliteSecurityScanRunRepository(host);
}

const RUN: SecurityScanRunRecord = {
  scanId: "scan:11111111-1111-4111-8111-111111111111",
  mode: "quick",
  trigger: "automatic",
  locale: "zh-CN",
  status: "running",
  startedAt: "2026-08-25T01:00:00.000Z",
  discoveredCount: 3,
  queuedCount: 3,
  completedCount: 0,
  failedCount: 0,
  skippedCount: 0,
};

test("stores and updates durable run-level scan evidence", async (t) => {
  const repository = repositoryFixture(t);
  await repository.save(RUN);
  assert.deepEqual(await repository.latest(), RUN);

  const complete: SecurityScanRunRecord = {
    ...RUN,
    status: "complete",
    finishedAt: "2026-08-25T01:00:02.000Z",
    completedCount: 0,
    skippedCount: 3,
    ruleVersion: "rules-v1",
  };
  await repository.save(complete);

  assert.deepEqual(await repository.latest(), complete);
});

test("marks queued and running rows interrupted during startup recovery", async (t) => {
  const repository = repositoryFixture(t);
  await repository.save(RUN);

  assert.equal(
    await repository.recoverInterrupted("2026-08-25T02:00:00.000Z"),
    1,
  );
  assert.deepEqual(await repository.latest(), {
    ...RUN,
    status: "cancelled",
    finishedAt: "2026-08-25T02:00:00.000Z",
    errorCode: "security.scanInterrupted",
  });
  assert.equal(
    await repository.recoverInterrupted("2026-08-25T03:00:00.000Z"),
    0,
  );
});
