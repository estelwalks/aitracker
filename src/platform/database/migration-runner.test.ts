import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DatabaseError } from "./contracts.ts";
import { TRUSTTOOLS_APPLICATION_ID } from "./contracts.ts";
import type { SqliteRow } from "./contracts.ts";
import { DatabaseHost } from "./database-host.server.ts";
import type { RuntimeVersionsProvider } from "./capability-probe.server.ts";
import {
  migrationChecksum,
  normalizeMigrationSql,
  readSchemaVersion,
  runMigrations,
  type MigrationDefinition,
} from "./migration-runner.server.ts";
import {
  LATEST_MIGRATION_VERSION,
  MIGRATIONS,
  PLATFORM_MIGRATION_0001_SQL,
} from "./migrations/index.ts";

/** Enough of node:test's TestContext for the shared test bed. */
interface TestScope {
  after(fn: () => void): void;
}

const APP_VERSION = "3.0.0-test";

/** The 11 first-wave tables (architecture §5.0), sorted by name. */
const FIRST_WAVE_TABLES = [
  "ai_daily_usage",
  "ai_executions",
  "app_preferences",
  "data_migration_runs",
  "insight_enhancement_cache",
  "insight_enhancement_lines",
  "insight_preferences",
  "model_profiles",
  "runtime_flags",
  "schema_migrations",
  "secure_secrets",
] as const;

const EXPECTED_INDEXES = [
  "idx_ai_executions_capability_started",
  "idx_ai_executions_profile_started",
  "idx_ai_executions_status_started",
  "idx_data_migration_runs_idempotency",
  "idx_insight_enhancement_cache_identity",
  "idx_insight_enhancement_cache_surface_expires",
  "idx_model_profiles_single_active",
] as const;

/** A harmless extra migration used to prove "only pending versions run". */
const PROBE_MIGRATION: MigrationDefinition = {
  version: LATEST_MIGRATION_VERSION + 1,
  name: "test_probe_next",
  sql: "CREATE TABLE t_mig_probe (x INTEGER) STRICT;\n",
};

/** Fails halfway so the transaction rollback can be observed. */
const BROKEN_MIGRATION: MigrationDefinition = {
  version: LATEST_MIGRATION_VERSION + 1,
  name: "test_broken_next",
  sql: "CREATE TABLE t_broken_probe (x INTEGER) STRICT;\nTHIS IS NOT SQL;\n",
};

const THIRD_MIGRATION: MigrationDefinition = {
  version: LATEST_MIGRATION_VERSION + 2,
  name: "test_probe_after_next",
  sql: "CREATE TABLE t_mig_third (x INTEGER) STRICT;\n",
};

function versionsProvider(): RuntimeVersionsProvider {
  return {
    getVersions: () => ({ nodeVersion: "24.19.0", sqliteVersion: "99.0.0" }),
  };
}

function rmTempDir(directory: string): void {
  try {
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  } catch {
    // Best effort; Windows may hold a handle briefly after close.
  }
}

/** Opens a real file-backed Host in a fresh temp directory (Windows/macOS). */
function openHost(scope: TestScope): DatabaseHost {
  const directory = mkdtempSync(join(tmpdir(), "tt-db-migration-"));
  const host = DatabaseHost.open({
    path: join(directory, "platform.db"),
    versionsProvider: versionsProvider(),
  });
  scope.after(() => host.close());
  scope.after(() => rmTempDir(directory));
  return host;
}

/** Monotonic fake clock: every read advances by `step` milliseconds. */
function fakeClock(start = 1_700_000_000_000, step = 5): () => number {
  let now = start - step;
  return () => (now += step);
}

function integer(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  throw new Error(`expected an integer column, received ${typeof value}`);
}

/** First column of a single-row PRAGMA result as a number. */
function pragmaInteger(host: DatabaseHost, sql: string): number {
  const row = host.prepare(sql).get();
  assert.ok(row !== undefined, `${sql} must return a row`);
  return integer(Object.values(row)[0]);
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  throw new Error(`expected a text column, received ${typeof value}`);
}

function objectNames(host: DatabaseHost, type: "table" | "index"): string[] {
  return host
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all(type)
    .map((row) => text(row.name));
}

function ledgerRows(host: DatabaseHost): SqliteRow[] {
  return host
    .prepare(
      "SELECT version, name, checksum, app_version, applied_at_ms, duration_ms FROM schema_migrations ORDER BY version ASC",
    )
    .all();
}

function isDatabaseError(code: string) {
  return (error: unknown): boolean =>
    error instanceof DatabaseError &&
    error.code === code &&
    error.operation === "migration";
}

test("migrates an empty database from 0 to latest and records the ledger row", (t) => {
  const host = openHost(t);
  assert.equal(readSchemaVersion(host), 0);

  const result = runMigrations({
    database: host,
    appVersion: APP_VERSION,
    clock: fakeClock(),
  });

  assert.equal(result.currentVersion, LATEST_MIGRATION_VERSION);
  assert.equal(result.applied.length, MIGRATIONS.length);
  const record = result.applied[0];
  assert.equal(record.version, 1);
  assert.equal(record.name, "0001_platform");
  assert.equal(record.checksum, migrationChecksum(PLATFORM_MIGRATION_0001_SQL));
  assert.equal(record.appVersion, APP_VERSION);
  assert.equal(record.appliedAtMs, 1_700_000_000_005);
  assert.equal(record.durationMs, 5);

  const rows = ledgerRows(host);
  assert.equal(
    rows.length,
    MIGRATIONS.length,
    "schema_migrations must hold every bundled migration row",
  );
  assert.equal(integer(rows[0].version), 1);
  assert.equal(text(rows[0].name), "0001_platform");
  assert.equal(text(rows[0].checksum), record.checksum);
  assert.equal(text(rows[0].app_version), APP_VERSION);
  assert.equal(integer(rows[0].applied_at_ms), record.appliedAtMs);
  assert.equal(integer(rows[0].duration_ms), 5);
  assert.equal(readSchemaVersion(host), LATEST_MIGRATION_VERSION);
});

test("migration 0001 stamps application_id and user_version (P1-4)", (t) => {
  const host = openHost(t);
  // A fresh database is unstamped (application_id 0) until migration 0001 runs.
  assert.equal(pragmaInteger(host, "PRAGMA application_id"), 0);

  const result = runMigrations({ database: host, appVersion: APP_VERSION });

  assert.equal(result.currentVersion, LATEST_MIGRATION_VERSION);
  assert.equal(
    pragmaInteger(host, "PRAGMA application_id"),
    TRUSTTOOLS_APPLICATION_ID,
    "migration 0001 must stamp the TrustTools application_id",
  );
  assert.equal(
    pragmaInteger(host, "PRAGMA user_version"),
    LATEST_MIGRATION_VERSION,
    "the migration runner must set user_version to the latest applied version",
  );
});

test("creates exactly the 11 first-wave STRICT tables and their indexes", (t) => {
  const host = openHost(t);
  runMigrations({
    database: host,
    appVersion: APP_VERSION,
    definitions: [MIGRATIONS[0]],
  });

  assert.deepEqual(
    objectNames(host, "table"),
    [...FIRST_WAVE_TABLES],
    "no non-first-wave table may be created by 0001",
  );
  for (const table of FIRST_WAVE_TABLES) {
    const row = host
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get(table);
    assert.ok(row !== undefined, `${table} must exist`);
    assert.match(
      text(row.sql).trim(),
      /\)\s*STRICT$/,
      `${table} must be declared STRICT`,
    );
  }
  const indexes = objectNames(host, "index");
  for (const index of EXPECTED_INDEXES) {
    assert.ok(indexes.includes(index), `missing index ${index}`);
  }
  const partial = host
    .prepare(
      "SELECT partial FROM pragma_index_list('model_profiles') WHERE name = ?",
    )
    .get("idx_model_profiles_single_active");
  assert.ok(partial !== undefined, "the single-active index must exist");
  assert.equal(
    integer(partial.partial),
    1,
    "the single-active index must be partial",
  );
});

test("re-running the migrator applies nothing and leaves the ledger untouched", (t) => {
  const host = openHost(t);
  const first = runMigrations({
    database: host,
    appVersion: APP_VERSION,
    clock: fakeClock(),
  });
  const before = ledgerRows(host);

  const second = runMigrations({
    database: host,
    appVersion: "9.9.9-other",
    clock: fakeClock(2_000_000_000_000),
  });

  assert.deepEqual(second.applied, []);
  assert.equal(second.currentVersion, first.currentVersion);
  const after = ledgerRows(host);
  assert.equal(after.length, MIGRATIONS.length);
  assert.equal(
    integer(after[0].applied_at_ms),
    integer(before[0].applied_at_ms),
  );
  assert.equal(text(after[0].app_version), APP_VERSION);
});

test("rejects a tampered checksum with migration-checksum", (t) => {
  const host = openHost(t);
  runMigrations({ database: host, appVersion: APP_VERSION });
  host
    .prepare("UPDATE schema_migrations SET checksum = ? WHERE version = 1")
    .run("0".repeat(64));

  assert.throws(
    () => runMigrations({ database: host, appVersion: APP_VERSION }),
    isDatabaseError("migration-checksum"),
  );
});

test("rejects a renamed applied migration with migration-checksum", (t) => {
  const host = openHost(t);
  runMigrations({ database: host, appVersion: APP_VERSION });
  host
    .prepare("UPDATE schema_migrations SET name = ? WHERE version = 1")
    .run("0001_platform_renamed");

  assert.throws(
    () => runMigrations({ database: host, appVersion: APP_VERSION }),
    isDatabaseError("migration-checksum"),
  );
});

test("rejects user_version that disagrees with the migration ledger", (t) => {
  const host = openHost(t);
  runMigrations({ database: host, appVersion: APP_VERSION });
  host.exec("PRAGMA user_version = 99");

  assert.throws(
    () => runMigrations({ database: host, appVersion: APP_VERSION }),
    isDatabaseError("migration-reverted"),
  );
});

test("rejects an empty ledger paired with a TrustTools application stamp", (t) => {
  const host = openHost(t);
  host.exec(`PRAGMA application_id = ${TRUSTTOOLS_APPLICATION_ID}`);
  assert.throws(
    () => runMigrations({ database: host, appVersion: APP_VERSION }),
    isDatabaseError("migration-reverted"),
  );
});

test("rejects a database ahead of the known definitions with migration-reverted", (t) => {
  const host = openHost(t);
  runMigrations({ database: host, appVersion: APP_VERSION });
  host
    .prepare(
      "INSERT INTO schema_migrations (version, name, checksum, app_version, applied_at_ms, duration_ms) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(999, "0999_from_the_future", "f".repeat(64), "4.0.0", 1, 0);

  assert.throws(
    () => runMigrations({ database: host, appVersion: APP_VERSION }),
    isDatabaseError("migration-reverted"),
  );
});

test("rejects a gap in the applied sequence with migration-reverted", (t) => {
  const host = openHost(t);
  runMigrations({ database: host, appVersion: APP_VERSION });
  // Ledger claims v1 and v3 are applied while v2 never ran: not a known
  // forward-only path, so v2 must not be back-filled out of order.
  host
    .prepare(
      "INSERT INTO schema_migrations (version, name, checksum, app_version, applied_at_ms, duration_ms) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(
      THIRD_MIGRATION.version,
      THIRD_MIGRATION.name,
      migrationChecksum(THIRD_MIGRATION.sql),
      APP_VERSION,
      1,
      0,
    );

  assert.throws(
    () =>
      runMigrations({
        database: host,
        appVersion: APP_VERSION,
        definitions: [...MIGRATIONS, PROBE_MIGRATION, THIRD_MIGRATION],
      }),
    isDatabaseError("migration-reverted"),
  );
});

test("applies only the pending versions after an interrupted-then-resumed run", (t) => {
  const host = openHost(t);
  runMigrations({ database: host, appVersion: APP_VERSION });

  const result = runMigrations({
    database: host,
    appVersion: APP_VERSION,
    definitions: [...MIGRATIONS, PROBE_MIGRATION],
    clock: fakeClock(1_800_000_000_000),
  });

  assert.equal(
    result.applied.length,
    1,
    "bundled migrations must not run twice",
  );
  assert.equal(result.applied[0].version, PROBE_MIGRATION.version);
  assert.equal(result.currentVersion, PROBE_MIGRATION.version);
  assert.equal(ledgerRows(host).length, MIGRATIONS.length + 1);
  assert.ok(objectNames(host, "table").includes("t_mig_probe"));
});

test("rolls a failing migration back completely and allows a retry", (t) => {
  const host = openHost(t);
  runMigrations({ database: host, appVersion: APP_VERSION });

  assert.throws(
    () =>
      runMigrations({
        database: host,
        appVersion: APP_VERSION,
        definitions: [...MIGRATIONS, BROKEN_MIGRATION],
      }),
    isDatabaseError("sql-error"),
  );

  const rows = ledgerRows(host);
  assert.equal(
    rows.length,
    MIGRATIONS.length,
    "the failed version must not be recorded",
  );
  assert.equal(integer(rows.at(-1)?.version), LATEST_MIGRATION_VERSION);
  assert.ok(
    !objectNames(host, "table").includes("t_broken_probe"),
    "the partially executed statement must be rolled back",
  );

  // The connection is usable and the fixed migration applies cleanly.
  const retry = runMigrations({
    database: host,
    appVersion: APP_VERSION,
    definitions: [...MIGRATIONS, PROBE_MIGRATION],
  });
  assert.equal(retry.currentVersion, PROBE_MIGRATION.version);
  assert.equal(ledgerRows(host).length, MIGRATIONS.length + 1);
});

test("rejects malformed definition lists with invalid-argument", (t) => {
  const host = openHost(t);
  const valid = MIGRATIONS[0];
  const cases: readonly MigrationDefinition[][] = [
    [],
    [valid, { ...PROBE_MIGRATION, version: 1 }],
    [valid, { ...PROBE_MIGRATION, version: 0 }],
    [valid, { ...PROBE_MIGRATION, version: 2.5 }],
    [valid, { ...PROBE_MIGRATION, name: valid.name }],
    [valid, { ...PROBE_MIGRATION, name: "  " }],
    [valid, { ...PROBE_MIGRATION, sql: "\r\n  \n" }],
  ];
  for (const definitions of cases) {
    assert.throws(
      () =>
        runMigrations({ database: host, appVersion: APP_VERSION, definitions }),
      isDatabaseError("invalid-argument"),
      `definitions should be rejected: ${JSON.stringify(definitions.map((d) => [d.version, d.name]))}`,
    );
  }
  assert.throws(
    () => runMigrations({ database: host, appVersion: "  " }),
    isDatabaseError("invalid-argument"),
  );
  // Nothing was created by any rejected call.
  assert.deepEqual(objectNames(host, "table"), []);
});

test("the inline SQL stays byte-identical to migrations/0001_platform.sql", () => {
  const fileText = readFileSync(
    new URL("./migrations/0001_platform.sql", import.meta.url),
    "utf8",
  );
  const fromFile = normalizeMigrationSql(fileText);
  const inline = normalizeMigrationSql(PLATFORM_MIGRATION_0001_SQL);

  assert.equal(
    inline,
    fromFile,
    "migrations/index.ts and migrations/0001_platform.sql have diverged",
  );
  assert.equal(
    migrationChecksum(fileText),
    migrationChecksum(PLATFORM_MIGRATION_0001_SQL),
  );
  assert.ok(MIGRATIONS.length >= 1);
  assert.equal(MIGRATIONS[0].sql, PLATFORM_MIGRATION_0001_SQL);
  // 11 first-wave tables, and nothing else, are declared in that text.
  const created = [...inline.matchAll(/CREATE TABLE (\w+)/g)].map(
    (match) => match[1],
  );
  assert.deepEqual([...created].sort(), [...FIRST_WAVE_TABLES]);
});
