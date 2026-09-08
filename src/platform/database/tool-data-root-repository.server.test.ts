import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { RuntimeVersionsProvider } from "./capability-probe.server.ts";
import { DatabaseHost } from "./database-host.server.ts";
import { runMigrations } from "./migration-runner.server.ts";
import { LATEST_MIGRATION_VERSION } from "./migrations/index.ts";
import {
  assertToolDataRootPath,
  createSqliteToolDataRootRepository,
} from "./tool-data-root-repository.server.ts";

/**
 * Migration 0003 repository: per-tool user data directories are the one
 * deliberate storage carve-out for user-chosen absolute paths. Repository
 * validation stays strict on shape (absolute, bounded, no control chars);
 * the forbidden-zone guards of app_preferences deliberately do NOT apply.
 */

interface TestScope {
  after(fn: () => void): void;
}

function versionsProvider(): RuntimeVersionsProvider {
  return {
    getVersions: () => ({ nodeVersion: "24.19.0", sqliteVersion: "99.0.0" }),
  };
}

function openHost(scope: TestScope): DatabaseHost {
  const directory = mkdtempSync(join(tmpdir(), "aitracker-db-tool-roots-"));
  const host = DatabaseHost.open({
    path: join(directory, "platform.db"),
    versionsProvider: versionsProvider(),
  });
  scope.after(() => host.close());
  scope.after(() => {
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch {
      // best effort
    }
  });
  const result = runMigrations({ database: host, appVersion: "test" });
  assert.equal(result.currentVersion, LATEST_MIGRATION_VERSION);
  return host;
}

test("tool_data_roots round-trips user-chosen absolute directories", async (t) => {
  const host = openHost(t);
  const repository = createSqliteToolDataRootRepository(host);

  // Windows drive-letter path with backslashes is the point of this carve-out.
  await repository.set("hermes", "D:\\hermes");
  await repository.set("claude-code", "/data/claude");
  const rows = await repository.list();
  assert.deepEqual(
    rows.map((row) => [row.toolId, row.dataDir]),
    [
      ["claude-code", "/data/claude"],
      ["hermes", "D:\\hermes"],
    ],
  );

  const record = await repository.get("hermes");
  assert.ok(record);
  assert.equal(record.dataDir, "D:\\hermes");

  assert.equal(await repository.delete("hermes"), true);
  assert.equal(await repository.get("hermes"), undefined);
  assert.equal(await repository.delete("hermes"), false);
});

test("repository validation rejects malformed overrides", async (t) => {
  const host = openHost(t);
  const repository = createSqliteToolDataRootRepository(host);

  await assert.rejects(
    () => repository.set("hermes", "relative/path"),
    TypeError,
  );
  await assert.rejects(
    () => repository.set("hermes", "/bad\u0000path"),
    TypeError,
  );
  await assert.rejects(
    () => repository.set("Not A Tool Id!", "/data/x"),
    TypeError,
  );
  await assert.rejects(() => repository.set("", "/data/x"), TypeError);
  await assert.rejects(
    () => repository.set("hermes", "/x".repeat(3000)),
    TypeError,
  );
});

test("path assertion is shared with the config service", () => {
  assertToolDataRootPath("hermes", "/data/hermes");
  assertToolDataRootPath("hermes", "C:/hermes");
  assertToolDataRootPath("hermes", "D:\\hermes\\profiles");
  assert.throws(() => assertToolDataRootPath("hermes", "~/.hermes"), TypeError);
  assert.throws(() => assertToolDataRootPath("hermes", ".hermes"), TypeError);
});
