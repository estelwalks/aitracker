import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createShadowAtomicJsonStore } from "../persistence/infrastructure/shadow-atomic-json-store.ts";
import type { AtomicJsonStore } from "../persistence/contracts.ts";
import { DEFAULT_TASK_PREFERENCES } from "../../modules/tasks/application/task-storage.ts";
import { createSqliteTaskPreferenceRepository } from "../../modules/tasks/infrastructure/sqlite-task-preference-repository.server.ts";
import { createSqliteTaskRunRepository } from "../../modules/tasks/infrastructure/sqlite-task-run-repository.server.ts";
import { createSqliteMonitoringStatusStore } from "../../modules/monitoring/sqlite-status-store.server.ts";
import { createSqliteHttpCacheRepository } from "./http-cache-repository.server.ts";
import { importAtomicJsonStore } from "./legacy-import.server.ts";
import { DatabaseHost } from "./database-host.server.ts";
import { runMigrations } from "./migration-runner.server.ts";
import { LATEST_MIGRATION_VERSION, MIGRATIONS } from "./migrations/index.ts";
import { createSqliteRuntimeFlagRepository } from "./runtime-flag-repository.server.ts";
import { loadStorageCutoverSnapshot } from "./storage-cutover.server.ts";

function hostForTest(t: { after(callback: () => void): void }): DatabaseHost {
  const directory = mkdtempSync(join(tmpdir(), "tt-m2-state-"));
  const host = DatabaseHost.open({
    path: join(directory, "platform.db"),
    versionsProvider: {
      getVersions: () => ({ nodeVersion: "24.19.0", sqliteVersion: "99.0.0" }),
    },
  });
  t.after(() => host.close());
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return host;
}

function memoryStore<T>(value: T, schemaVersion = 1): AtomicJsonStore<T> {
  return {
    async read() {
      return { value, source: "stored", schemaVersion };
    },
    async write(next) {
      value = next;
    },
  };
}

test("upgrades an intermediate v1 database to the M2 latest schema", (t) => {
  const host = hostForTest(t);
  runMigrations({
    database: host,
    appVersion: "test",
    definitions: [MIGRATIONS[0]],
  });
  assert.equal(
    Number(Object.values(host.prepare("PRAGMA user_version").get()!)[0]),
    1,
  );
  const result = runMigrations({ database: host, appVersion: "test" });
  assert.equal(result.currentVersion, LATEST_MIGRATION_VERSION);
  assert.deepEqual(
    result.applied.map((item) => item.version),
    [2],
  );
  const tables = host
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
    .all()
    .map((row) => row.name);
  for (const expected of [
    "task_preferences",
    "task_runs",
    "monitoring_state",
    "monitoring_collectors",
    "http_cache_entries",
  ]) {
    assert.ok(tables.includes(expected), `missing ${expected}`);
  }
});

test("SQLite task preferences preserve the repository contract", async (t) => {
  const host = hostForTest(t);
  runMigrations({ database: host, appVersion: "test" });
  const repository = createSqliteTaskPreferenceRepository({
    database: host,
    clock: { now: () => new Date("2026-08-19T10:00:00.000Z") },
  });
  await repository.save({
    ...DEFAULT_TASK_PREFERENCES,
    updatedAt: "2026-08-19T09:00:00.000Z",
    tasks: {
      "usage.refresh": {
        enabled: true,
        schedule: { kind: "interval", minutes: 15 },
      },
      "retention.apply": {
        enabled: false,
        schedule: { kind: "daily", localTime: "03:00" },
      },
    },
  });
  assert.deepEqual((await repository.read()).tasks, {
    "retention.apply": {
      enabled: false,
      schedule: { kind: "daily", localTime: "03:00" },
    },
    "usage.refresh": {
      enabled: true,
      schedule: { kind: "interval", minutes: 15 },
    },
  });
  const next = await repository.set("usage.refresh", {
    enabled: false,
    schedule: { kind: "interval", minutes: 30 },
  });
  assert.equal(next.updatedAt, "2026-08-19T10:00:00.000Z");
  assert.equal(next.tasks["usage.refresh"].enabled, false);
});

test("task running recovery and monitoring state have SQLite parity", async (t) => {
  const host = hostForTest(t);
  runMigrations({ database: host, appVersion: "test" });
  const runs = createSqliteTaskRunRepository({
    database: host,
    clock: { now: () => new Date("2026-08-19T10:01:00.000Z") },
  });
  await runs.append({
    runId: "run:sqlite-recovery",
    taskId: "usage.refresh",
    trigger: "schedule",
    status: "running",
    queuedAt: "2026-08-19T10:00:00.000Z",
    startedAt: "2026-08-19T10:00:10.000Z",
    attempt: 1,
    correlationId: "corr:sqlite-recovery",
  });
  const recovered = await runs.recoverRunning();
  assert.equal(recovered[0].status, "abandoned");
  assert.equal(recovered[0].durationMs, 50_000);
  assert.equal((await runs.list({ limit: 1 }))[0].status, "abandoned");

  const monitoring = createSqliteMonitoringStatusStore(host);
  await monitoring.save({
    module: "monitoring",
    running: true,
    startedAt: "2026-08-19T10:00:00.000Z",
    heartbeatAt: "2026-08-19T10:00:30.000Z",
    pendingCount: 1,
    collectors: [{ id: "installation", state: "healthy", pending: false }],
  });
  assert.deepEqual(await monitoring.load(), {
    module: "monitoring",
    running: true,
    startedAt: "2026-08-19T10:00:00.000Z",
    heartbeatAt: "2026-08-19T10:00:30.000Z",
    pendingCount: 1,
    collectors: [{ id: "installation", state: "healthy", pending: false }],
  });
});

test("legacy import is idempotent and rolls target writes back on failure", async (t) => {
  const host = hostForTest(t);
  runMigrations({ database: host, appVersion: "test" });
  const source = memoryStore({ schemaVersion: 1, enabled: true });
  const input = {
    database: host,
    source,
    sourceIdentity: "task-preferences-v1",
  };
  await assert.rejects(
    importAtomicJsonStore({
      ...input,
      importValue(value, database) {
        database
          .prepare(
            "INSERT INTO runtime_flags (flag_key, value_json, updated_at_ms) VALUES (?, ?, ?)",
          )
          .run("m2.probe", JSON.stringify(value), 1);
        throw new Error("injected failure");
      },
    }),
  );
  assert.equal(
    host.prepare("SELECT COUNT(*) AS count FROM runtime_flags").get()!.count,
    0n,
  );
  assert.equal(
    host.prepare("SELECT status FROM data_migration_runs").get()!.status,
    "failed",
  );
  const success = await importAtomicJsonStore({
    ...input,
    importValue(value, database) {
      database
        .prepare(
          "INSERT INTO runtime_flags (flag_key, value_json, updated_at_ms) VALUES (?, ?, ?)",
        )
        .run("m2.probe", JSON.stringify(value), 1);
      return { rowsRead: 1, rowsWritten: 1 };
    },
  });
  assert.equal(success.status, "succeeded");
  const repeated = await importAtomicJsonStore({
    ...input,
    importValue() {
      throw new Error("must not run for an idempotency hit");
    },
  });
  assert.equal(repeated.idempotentHit, true);
  assert.equal(
    host.prepare("SELECT COUNT(*) AS count FROM data_migration_runs").get()!
      .count,
    1n,
  );
});

test("shadow store falls back on read and treats legacy write as best effort", async () => {
  const calls: string[] = [];
  const sqlite: AtomicJsonStore<number> = {
    async read() {
      throw new Error("sqlite unavailable");
    },
    async write(value) {
      calls.push(`sqlite:${value}`);
    },
  };
  const legacy: AtomicJsonStore<number> = {
    async read() {
      return { value: 7, source: "stored", schemaVersion: 1 };
    },
    async write() {
      calls.push("legacy");
      throw new Error("legacy unavailable");
    },
  };
  const errors: string[] = [];
  const shadow = createShadowAtomicJsonStore({
    sqlite,
    legacy,
    readFromSqlite: () => true,
    onSqliteReadError: () => errors.push("read"),
    onLegacyWriteError: () => errors.push("write"),
  });
  assert.equal((await shadow.read()).value, 7);
  await shadow.write(9);
  assert.deepEqual(calls, ["sqlite:9", "legacy"]);
  assert.deepEqual(errors, ["read", "write"]);
});

test("HTTP cache hashes keys, enforces privacy and deletes expired rows", async (t) => {
  const host = hostForTest(t);
  runMigrations({ database: host, appVersion: "test" });
  const cache = createSqliteHttpCacheRepository(host);
  await cache.put({
    namespace: "market",
    key: "page:1:private-query",
    payload: { skills: [{ id: "safe" }] },
    fetchedAtMs: 100,
    expiresAtMs: 200,
    statusCode: 200,
  });
  assert.deepEqual(
    (
      await cache.get<{ skills: { id: string }[] }>(
        "market",
        "page:1:private-query",
      )
    )?.payload,
    {
      skills: [{ id: "safe" }],
    },
  );
  const storedKey = host
    .prepare("SELECT cache_key FROM http_cache_entries")
    .get()!.cache_key;
  assert.notEqual(storedKey, "page:1:private-query");
  await assert.rejects(
    cache.put({
      namespace: "market",
      key: "unsafe",
      payload: { path: "C:/Users/example/private" },
      fetchedAtMs: 100,
      expiresAtMs: 200,
    }),
  );
  assert.equal(await cache.deleteExpired("market", 200), 1);
});

test("runtime flags enforce privacy and drive an explicit read cutover", async (t) => {
  const host = hostForTest(t);
  runMigrations({ database: host, appVersion: "test" });
  const flags = createSqliteRuntimeFlagRepository(host);
  await flags.set("storage.sqlite.tasks.read", true, 100);
  const cutover = await loadStorageCutoverSnapshot(flags);
  assert.equal(cutover.isEnabled("tasks"), true);
  assert.equal(cutover.isEnabled("monitoring"), false);
  await assert.rejects(
    flags.set("unsafe.flag", { location: "C:/Users/example/private" }),
  );
  assert.equal(await flags.get("unsafe.flag"), undefined);
});
