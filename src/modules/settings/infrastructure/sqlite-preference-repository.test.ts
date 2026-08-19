import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DatabaseError } from "../../../platform/database/contracts.ts";
import { DatabaseHost } from "../../../platform/database/database-host.server.ts";
import { runMigrations } from "../../../platform/database/migration-runner.server.ts";
import { createSqliteRuntimeFlagRepository } from "../../../platform/database/runtime-flag-repository.server.ts";
import { createSqlitePreferenceRepository } from "./sqlite-preference-repository.server.ts";

function fixture(t: { after(fn: () => void): void }): DatabaseHost {
  const directory = mkdtempSync(join(tmpdir(), "tt-pref-repo-"));
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

test("preferences round-trip JSON types and legacy import is idempotent", (t) => {
  const repository = createSqlitePreferenceRepository(fixture(t));
  const entry = {
    key: "settings.retentionDays",
    value: 90,
    updatedAtMs: 100,
  } as const;
  assert.deepEqual(repository.importLegacy([entry]), { insertedOrUpdated: 1 });
  assert.deepEqual(repository.importLegacy([entry]), { insertedOrUpdated: 0 });
  assert.deepEqual(repository.get(entry.key), entry);
  repository.set({
    key: "ui.layout",
    value: { compact: true, rows: [1, 2] },
    updatedAtMs: 101,
  });
  assert.equal(repository.list().length, 2);
});

test("preferences reject secret-bearing keys and values before SQL", (t) => {
  const repository = createSqlitePreferenceRepository(fixture(t));
  assert.throws(
    () =>
      repository.set({
        key: "model.apiKey",
        value: "sk-example-secret-value-123456",
        updatedAtMs: 1,
      }),
    (error: unknown) =>
      error instanceof DatabaseError && error.code === "invalid-argument",
  );
  assert.equal(repository.list().length, 0);
});

test("runtime flags round-trip through SQLite", async (t) => {
  const host = fixture(t);
  const flags = createSqliteRuntimeFlagRepository(host);
  await flags.set("rollout.sqlite", true, 20);
  assert.equal((await flags.get("rollout.sqlite"))?.value, true);
});
