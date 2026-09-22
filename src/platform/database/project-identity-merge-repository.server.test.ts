import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DatabaseHost } from "./database-host.server.ts";
import { runMigrations } from "./migration-runner.server.ts";
import { LATEST_MIGRATION_VERSION } from "./migrations/index.ts";
import {
  createSqliteProjectIdentityMergeRepository,
  PROJECT_IDENTITY_PATTERN,
} from "./project-identity-merge-repository.server.ts";

const source = "A".repeat(43);
const target = "B".repeat(43);
const other = "C".repeat(43);

function openDatabase(t: { after(fn: () => void): void }): DatabaseHost {
  const directory = mkdtempSync(join(tmpdir(), "aitracker-project-merges-"));
  const host = DatabaseHost.open({
    path: join(directory, "platform.db"),
    versionsProvider: {
      getVersions: () => ({ nodeVersion: "24.19.0", sqliteVersion: "99.0.0" }),
    },
  });
  const migration = runMigrations({ database: host, appVersion: "test" });
  assert.equal(migration.currentVersion, LATEST_MIGRATION_VERSION);
  t.after(() => host.close());
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return host;
}

test("project identity merges resolve chains and survive a new repository", (t) => {
  const database = openDatabase(t);
  const repository = createSqliteProjectIdentityMergeRepository(database);

  assert.match(source, PROJECT_IDENTITY_PATTERN);
  repository.merge(source, target, 123);
  repository.merge(other, source, 456);
  assert.equal(repository.resolve(source), target);
  assert.equal(repository.resolve(other), target);
  assert.deepEqual(repository.list(), [
    { sourceIdentity: source, targetIdentity: target, createdAtMs: 123 },
    { sourceIdentity: other, targetIdentity: target, createdAtMs: 456 },
  ]);

  const rehydrated = createSqliteProjectIdentityMergeRepository(database);
  assert.equal(rehydrated.resolve(other), target);
  rehydrated.unmerge(source);
  assert.equal(rehydrated.resolve(source), source);
  assert.equal(rehydrated.resolve(other), target);
});

test("project identity merges avoid cycles and reject malformed identities", (t) => {
  const database = openDatabase(t);
  const repository = createSqliteProjectIdentityMergeRepository(database);
  assert.throws(() => repository.merge("short", target), TypeError);
  assert.throws(() => repository.merge(source, "contains!"), TypeError);
  repository.merge(source, target);
  repository.merge(target, source);
  assert.equal(repository.resolve(target), target);
});
