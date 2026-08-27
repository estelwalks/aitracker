import assert from "node:assert/strict";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import type { RuntimeVersionsProvider } from "./capability-probe.server.ts";
import { DatabaseError } from "./contracts.ts";
import { DatabaseHost } from "./database-host.server.ts";
import {
  createOnlineBackup,
  createPreMigrationBackup,
  listBackupFiles,
  listVerifiedBackups,
  pruneBackups,
  readBackupManifestIndex,
  sha256OfFile,
  tryReadBackupManifestIndex,
} from "./backup.server.ts";
import { readSchemaVersion, runMigrations } from "./migration-runner.server.ts";
import { LATEST_MIGRATION_VERSION } from "./migrations/index.ts";

/** Enough of node:test's TestContext for the shared test bed. */
interface TestScope {
  after(fn: () => void): void;
}

const APP_VERSION = "3.0.0-test";
const SQLITE_VERSION = "99.0.0";

function versionsProvider(): RuntimeVersionsProvider {
  return {
    getVersions: () => ({
      nodeVersion: "24.19.0",
      sqliteVersion: SQLITE_VERSION,
    }),
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

/** Opens a migrated, file-backed database in a fresh temp directory. */
function openMigratedDb(scope: TestScope): {
  host: DatabaseHost;
  directory: string;
  databasePath: string;
} {
  const directory = mkdtempSync(join(tmpdir(), "aitracker-db-backup-"));
  const databasePath = join(directory, "platform.db");
  const host = DatabaseHost.open({
    path: databasePath,
    versionsProvider: versionsProvider(),
  });
  scope.after(() => host.close());
  scope.after(() => rmTempDir(directory));
  const result = runMigrations({ database: host, appVersion: APP_VERSION });
  assert.equal(result.currentVersion, LATEST_MIGRATION_VERSION);
  return { host, directory, databasePath };
}

function insertFlag(host: DatabaseHost, key: string, value: string): void {
  host
    .prepare(
      "INSERT INTO runtime_flags (flag_key, value_json, updated_at_ms) VALUES (?, ?, ?)",
    )
    .run(key, value, 1);
}

function readFlag(host: DatabaseHost, key: string): string | undefined {
  const row = host
    .prepare("SELECT value_json FROM runtime_flags WHERE flag_key = ?")
    .get(key);
  return row === undefined ? undefined : String(row.value_json);
}

function quickCheckOk(path: string): boolean {
  const database = new DatabaseSync(path, {
    readOnly: true,
    readBigInts: true,
  });
  try {
    const rows = database.prepare("PRAGMA quick_check").all();
    return (
      rows.length > 0 &&
      rows.every((row) => String(Object.values(row)[0]).toLowerCase() === "ok")
    );
  } finally {
    database.close();
  }
}

test("backs up a migrated database with uncheckpointed WAL data and round-trips it", async (t) => {
  const { host, directory } = openMigratedDb(t);
  const backupsDirectory = join(directory, "backups");
  insertFlag(host, "flag-a", '"value-a"');
  insertFlag(host, "flag-b", '"value-b"');
  // No checkpoint: the two rows may still live in the WAL at backup time.

  const backup = await createOnlineBackup({
    host,
    backupsDirectory,
    appVersion: APP_VERSION,
    sqliteVersion: SQLITE_VERSION,
  });

  // The returned manifest carries every field with values that match reality.
  assert.equal(backup.manifest.kind, "daily");
  assert.equal(backup.manifest.schemaVersion, LATEST_MIGRATION_VERSION);
  assert.equal(backup.manifest.appVersion, APP_VERSION);
  assert.equal(backup.manifest.sqliteVersion, SQLITE_VERSION);
  assert.equal(backup.manifest.sha256, await sha256OfFile(backup.path));
  assert.equal(backup.manifest.sizeBytes, statSync(backup.path).size);
  assert.equal(typeof backup.manifest.createdAtMs, "number");

  // The manifest is persisted next to the backups.
  const onDisk = readBackupManifestIndex(backupsDirectory);
  assert.deepEqual(onDisk[basename(backup.path)], backup.manifest);

  // The backup file itself passes a read-only quick_check and holds the data.
  assert.equal(quickCheckOk(backup.path), true);
  const readOnly = new DatabaseSync(backup.path, {
    readOnly: true,
    readBigInts: true,
  });
  try {
    const rows = readOnly
      .prepare(
        "SELECT flag_key, value_json FROM runtime_flags ORDER BY flag_key",
      )
      .all();
    assert.deepEqual(
      rows.map((row) => [row.flag_key, row.value_json]),
      [
        ["flag-a", '"value-a"'],
        ["flag-b", '"value-b"'],
      ],
    );
  } finally {
    readOnly.close();
  }

  // Restore round-trip: copy the backup to a fresh database and re-run the
  // migration runner, which must see the schema version and the data.
  const restoredPath = join(directory, "restored.db");
  copyFileSync(backup.path, restoredPath);
  const restored = DatabaseHost.open({
    path: restoredPath,
    versionsProvider: versionsProvider(),
  });
  t.after(() => restored.close());
  assert.equal(readSchemaVersion(restored), LATEST_MIGRATION_VERSION);
  assert.equal(readFlag(restored, "flag-a"), '"value-a"');
  assert.equal(readFlag(restored, "flag-b"), '"value-b"');
  const reapply = runMigrations({
    database: restored,
    appVersion: APP_VERSION,
  });
  assert.deepEqual(reapply.applied, []);
  restored.close();

  // The source host is still the live writer and sees the same data.
  assert.equal(readFlag(host, "flag-a"), '"value-a"');
});

test("consecutive backups never overwrite each other and keep distinct contents", async (t) => {
  const { host, directory } = openMigratedDb(t);
  const backupsDirectory = join(directory, "backups");
  const fixedNow = () => 1_700_000_000_000; // Same second forces a name clash.

  insertFlag(host, "flag-first", '"first"');
  const first = await createOnlineBackup({
    host,
    backupsDirectory,
    appVersion: APP_VERSION,
    sqliteVersion: SQLITE_VERSION,
    now: fixedNow,
  });
  insertFlag(host, "flag-second", '"second"');
  const second = await createOnlineBackup({
    host,
    backupsDirectory,
    appVersion: APP_VERSION,
    sqliteVersion: SQLITE_VERSION,
    now: fixedNow,
  });

  assert.notEqual(first.path, second.path);
  assert.ok(first.path.endsWith(".db"));
  assert.ok(second.path.endsWith(".db"));
  assert.equal(existsSync(first.path), true);
  assert.equal(existsSync(second.path), true);

  const readOnly = new DatabaseSync(first.path, {
    readOnly: true,
    readBigInts: true,
  });
  try {
    assert.equal(
      readOnly
        .prepare("SELECT value_json FROM runtime_flags WHERE flag_key = ?")
        .get("flag-first")?.value_json,
      '"first"',
    );
    assert.equal(
      readOnly
        .prepare("SELECT COUNT(*) AS n FROM runtime_flags WHERE flag_key = ?")
        .get("flag-second")?.n,
      0n,
    );
  } finally {
    readOnly.close();
  }

  const readOnlySecond = new DatabaseSync(second.path, {
    readOnly: true,
    readBigInts: true,
  });
  try {
    assert.equal(
      readOnlySecond
        .prepare("SELECT value_json FROM runtime_flags WHERE flag_key = ?")
        .get("flag-second")?.value_json,
      '"second"',
    );
    assert.equal(
      readOnlySecond
        .prepare("SELECT COUNT(*) AS n FROM runtime_flags WHERE flag_key = ?")
        .get("flag-first")?.n,
      1n,
    );
  } finally {
    readOnlySecond.close();
  }
});

test("listBackupFiles verifies through the manifest and reports every rejected file", async (t) => {
  const { host, directory } = openMigratedDb(t);
  const backupsDirectory = join(directory, "backups");

  const good = await createOnlineBackup({
    host,
    backupsDirectory,
    appVersion: APP_VERSION,
    sqliteVersion: SQLITE_VERSION,
    now: () => 1_000_000,
  });
  const toCorrupt = await createOnlineBackup({
    host,
    backupsDirectory,
    appVersion: APP_VERSION,
    sqliteVersion: SQLITE_VERSION,
    now: () => 2_000_000,
  });

  // Corrupt `toCorrupt`'s header so it can no longer pass quick_check.
  const descriptor = openSync(toCorrupt.path, "r+");
  try {
    writeSync(descriptor, Buffer.alloc(64, 0x41), 0, 64, 0);
  } finally {
    closeSync(descriptor);
  }
  // A stray file that is not even a database, and has no manifest record.
  writeFileSync(join(backupsDirectory, "garbage.db"), "not a sqlite database");
  // A recorded backup whose file was deleted behind our back.
  const missing = join(backupsDirectory, "aitracker-19990101-000000.db");
  writeFileSync(missing, readFileSync(good.path));
  const index = readBackupManifestIndex(backupsDirectory);
  writeFileSync(
    join(backupsDirectory, "manifest.json"),
    `${JSON.stringify(
      { ...index, [basename(missing)]: index[basename(good.path)] },
      null,
      2,
    )}\n`,
    "utf8",
  );
  rmSync(missing);

  const listed = await listVerifiedBackups(backupsDirectory);
  assert.deepEqual(
    listed.map((backup) => backup.path),
    [good.path],
    "only the intact, manifest-backed backup should be listed",
  );
  assert.equal(listed[0].manifest.sha256, await sha256OfFile(good.path));

  // Nothing is silently dropped: every rejected file is reported with a reason
  // so the UI can tell the user why a backup cannot be used.
  const inventory = await listBackupFiles(backupsDirectory);
  assert.deepEqual(
    inventory.verified.map((backup) => backup.path),
    [good.path],
  );
  assert.deepEqual(
    [...inventory.unverified].sort((a, b) => a.path.localeCompare(b.path)),
    [
      { path: toCorrupt.path, reason: "quick-check-failed" },
      {
        path: join(backupsDirectory, "garbage.db"),
        reason: "no-manifest-record",
      },
      { path: missing, reason: "missing-file" },
    ].sort((a, b) => a.path.localeCompare(b.path)),
  );
});

test("a damaged manifest is reported as corrupt, never as an empty index", async (t) => {
  const { host, directory } = openMigratedDb(t);
  const backupsDirectory = join(directory, "backups");
  const backup = await createOnlineBackup({
    host,
    backupsDirectory,
    appVersion: APP_VERSION,
    sqliteVersion: SQLITE_VERSION,
  });
  const manifestPath = join(backupsDirectory, "manifest.json");

  for (const damaged of ["{ truncated", "[]", "null", '"a string"']) {
    writeFileSync(manifestPath, damaged, "utf8");
    assert.throws(
      () => readBackupManifestIndex(backupsDirectory),
      (error: unknown) =>
        error instanceof DatabaseError &&
        error.code === "corrupt" &&
        error.operation === "backup",
      `must not be accepted: ${damaged}`,
    );
    await assert.rejects(
      () => listVerifiedBackups(backupsDirectory),
      (error: unknown) =>
        error instanceof DatabaseError && error.code === "corrupt",
    );
    assert.equal(
      tryReadBackupManifestIndex(backupsDirectory),
      undefined,
      "the try-variant reports the damage as undefined",
    );
  }

  // A missing manifest is a legitimately empty index, not corruption.
  rmSync(manifestPath);
  assert.deepEqual(readBackupManifestIndex(backupsDirectory), {});
  assert.deepEqual(tryReadBackupManifestIndex(backupsDirectory), {});
  assert.deepEqual(await listVerifiedBackups(backupsDirectory), []);
  assert.deepEqual(await listBackupFiles(backupsDirectory), {
    verified: [],
    unverified: [{ path: backup.path, reason: "no-manifest-record" }],
  });
});

test("concurrent backups are serialized: distinct files and one manifest entry each", async (t) => {
  const { host, directory } = openMigratedDb(t);
  const backupsDirectory = join(directory, "backups");
  insertFlag(host, "flag", '"value"');
  // The same second for both calls: without the in-process mutex both would
  // reserve the same file name and one of them would lose its manifest entry.
  const fixedNow = () => 1_700_000_000_000;

  const [first, second] = await Promise.all([
    createOnlineBackup({
      host,
      backupsDirectory,
      appVersion: APP_VERSION,
      sqliteVersion: SQLITE_VERSION,
      now: fixedNow,
    }),
    createOnlineBackup({
      host,
      backupsDirectory,
      appVersion: APP_VERSION,
      sqliteVersion: SQLITE_VERSION,
      now: fixedNow,
    }),
  ]);

  assert.notEqual(first.path, second.path);
  const index = readBackupManifestIndex(backupsDirectory);
  assert.deepEqual(index[basename(first.path)], first.manifest);
  assert.deepEqual(index[basename(second.path)], second.manifest);
  assert.deepEqual(
    (await listVerifiedBackups(backupsDirectory))
      .map((backup) => backup.path)
      .sort(),
    [first.path, second.path].sort(),
  );
  assert.deepEqual(
    readdirSync(backupsDirectory)
      .filter((name) => name.endsWith(".tmp"))
      .sort(),
    [],
    "no temporary file may survive",
  );
});

test("a failed backup does not poison the queue for the next caller", async (t) => {
  const { host, directory } = openMigratedDb(t);
  const backupsDirectory = join(directory, "backups");

  await assert.rejects(
    createOnlineBackup({
      host,
      backupsDirectory,
      appVersion: "   ",
      sqliteVersion: SQLITE_VERSION,
    }),
    (error: unknown) =>
      error instanceof DatabaseError && error.code === "invalid-argument",
  );
  const backup = await createOnlineBackup({
    host,
    backupsDirectory,
    appVersion: APP_VERSION,
    sqliteVersion: SQLITE_VERSION,
  });
  assert.equal(existsSync(backup.path), true);
});

test("the backup borrows the Host connection instead of opening a second writer", async (t) => {
  const { host, directory } = openMigratedDb(t);
  const backupsDirectory = join(directory, "backups");

  const original = DatabaseHost.prototype.withUnderlyingConnection;
  let borrowed = 0;
  DatabaseHost.prototype.withUnderlyingConnection = function borrow<T>(
    this: DatabaseHost,
    fn: (database: DatabaseSync) => T,
  ): T {
    borrowed += 1;
    const invoke = original as (
      this: DatabaseHost,
      borrow: (database: DatabaseSync) => T,
    ) => T;
    return invoke.call(this, fn);
  };
  t.after(() => {
    DatabaseHost.prototype.withUnderlyingConnection = original;
  });

  const backup = await createOnlineBackup({
    host,
    backupsDirectory,
    appVersion: APP_VERSION,
    sqliteVersion: SQLITE_VERSION,
  });

  assert.equal(
    borrowed,
    1,
    "exactly one borrow of the single writable connection",
  );
  assert.equal(quickCheckOk(backup.path), true);
  assert.equal(host.isOpen, true, "borrowing must not close the Host");
});

test("a backupsDirectory that is a file fails with io-failure and leaves no partial artifacts", async (t) => {
  const { host, directory } = openMigratedDb(t);
  const filePath = join(directory, "not-a-directory");
  writeFileSync(filePath, "x");

  await assert.rejects(
    createOnlineBackup({
      host,
      backupsDirectory: filePath,
      appVersion: APP_VERSION,
      sqliteVersion: SQLITE_VERSION,
    }),
    (error: unknown) =>
      error instanceof DatabaseError &&
      error.code === "io-failure" &&
      error.operation === "backup" &&
      error.message === "backup:io-failure",
  );

  // No backup, manifest, or temporary file may have been produced.
  const leftovers = readdirSync(directory).filter(
    (name) =>
      name.endsWith(".db") || name.endsWith(".tmp") || name === "manifest.json",
  );
  assert.deepEqual(leftovers, ["platform.db"]);
});

test("createPreMigrationBackup records kind pre-migration", async (t) => {
  const { host, directory } = openMigratedDb(t);
  const backupsDirectory = join(directory, "backups");
  const backup = await createPreMigrationBackup({
    host,
    backupsDirectory,
    appVersion: APP_VERSION,
    sqliteVersion: SQLITE_VERSION,
    now: () => 1_700_000_000_000,
  });
  assert.equal(backup.manifest.kind, "pre-migration");
  const onDisk = readBackupManifestIndex(backupsDirectory);
  assert.equal(onDisk[basename(backup.path)].kind, "pre-migration");
});

test("pruneBackups keeps recent and pre-migration backups and deletes expired daily", async (t) => {
  const { host, directory } = openMigratedDb(t);
  const backupsDirectory = join(directory, "backups");
  const DAY = 86_400_000;
  const now = 1_700_000_000_000;

  const recent = await createOnlineBackup({
    host,
    backupsDirectory,
    appVersion: APP_VERSION,
    sqliteVersion: SQLITE_VERSION,
    now: () => now,
  });
  const expired = await createOnlineBackup({
    host,
    backupsDirectory,
    appVersion: APP_VERSION,
    sqliteVersion: SQLITE_VERSION,
    now: () => now - 10 * DAY,
  });
  const preMigration = await createPreMigrationBackup({
    host,
    backupsDirectory,
    appVersion: APP_VERSION,
    sqliteVersion: SQLITE_VERSION,
    now: () => now - 10 * DAY,
  });

  const result = pruneBackups({
    backupsDirectory,
    keepDays: 7,
    now: () => now,
  });

  assert.deepEqual(result.deleted, [basename(expired.path)]);
  assert.equal(existsSync(expired.path), false);
  assert.equal(existsSync(recent.path), true);
  assert.equal(existsSync(preMigration.path), true);

  const index = readBackupManifestIndex(backupsDirectory);
  assert.equal(index[basename(expired.path)], undefined);
  assert.ok(index[basename(recent.path)] !== undefined);
  assert.ok(index[basename(preMigration.path)] !== undefined);
});

test("pruneBackups never deletes files without a manifest record", async (t) => {
  const { host, directory } = openMigratedDb(t);
  const backupsDirectory = join(directory, "backups");
  const DAY = 86_400_000;
  const now = 1_700_000_000_000;

  await createOnlineBackup({
    host,
    backupsDirectory,
    appVersion: APP_VERSION,
    sqliteVersion: SQLITE_VERSION,
    now: () => now,
  });
  const expired = await createOnlineBackup({
    host,
    backupsDirectory,
    appVersion: APP_VERSION,
    sqliteVersion: SQLITE_VERSION,
    now: () => now - 10 * DAY,
  });
  const stray = join(backupsDirectory, "aitracker-19900101-000000.db");
  writeFileSync(stray, "not a sqlite database");

  const result = pruneBackups({
    backupsDirectory,
    keepDays: 7,
    now: () => now,
  });

  assert.equal(existsSync(stray), true, "stray files are never deleted");
  assert.deepEqual(result.deleted, [basename(expired.path)]);
});

test("pruneBackups drops only the oldest pre-migration backup past keepDays*4", async (t) => {
  const { host, directory } = openMigratedDb(t);
  const backupsDirectory = join(directory, "backups");
  const DAY = 86_400_000;
  const now = 1_700_000_000_000;

  const oldest = await createPreMigrationBackup({
    host,
    backupsDirectory,
    appVersion: APP_VERSION,
    sqliteVersion: SQLITE_VERSION,
    now: () => now - 40 * DAY,
  });
  const newer = await createPreMigrationBackup({
    host,
    backupsDirectory,
    appVersion: APP_VERSION,
    sqliteVersion: SQLITE_VERSION,
    now: () => now - 30 * DAY,
  });

  const result = pruneBackups({
    backupsDirectory,
    keepDays: 7,
    now: () => now,
  });

  // keepDays * 4 = 28 days: the 40-day-old backup is dropped, the 30-day-old is
  // the newest pre-migration backup and stays.
  assert.deepEqual(result.deleted, [basename(oldest.path)]);
  assert.equal(existsSync(oldest.path), false);
  assert.equal(existsSync(newer.path), true);
});

test("pruneBackups requires both manifest and filename timestamps to be expired", async (t) => {
  const { host, directory } = openMigratedDb(t);
  const backupsDirectory = join(directory, "backups");
  const DAY = 86_400_000;
  const now = 1_700_000_000_000;

  const backup = await createOnlineBackup({
    host,
    backupsDirectory,
    appVersion: APP_VERSION,
    sqliteVersion: SQLITE_VERSION,
    now: () => now,
  });
  const index = readBackupManifestIndex(backupsDirectory);
  const name = basename(backup.path);
  // Forge only the manifest timestamp; the file name is still recent.
  const forged = {
    ...index,
    [name]: { ...index[name], createdAtMs: now - 10 * DAY },
  };
  writeFileSync(
    join(backupsDirectory, "manifest.json"),
    `${JSON.stringify(forged, null, 2)}\n`,
    "utf8",
  );

  const result = pruneBackups({
    backupsDirectory,
    keepDays: 7,
    now: () => now,
  });

  assert.deepEqual(result.deleted, []);
  assert.equal(existsSync(backup.path), true);
});

test("pruneBackups retains and reports a manifest entry when deletion fails", async (t) => {
  const { host, directory } = openMigratedDb(t);
  const backupsDirectory = join(directory, "backups");
  const DAY = 86_400_000;
  const now = 1_700_000_000_000;
  await createOnlineBackup({
    host,
    backupsDirectory,
    appVersion: APP_VERSION,
    sqliteVersion: SQLITE_VERSION,
    now: () => now,
  });
  const expired = await createOnlineBackup({
    host,
    backupsDirectory,
    appVersion: APP_VERSION,
    sqliteVersion: SQLITE_VERSION,
    now: () => now - 10 * DAY,
  });

  const result = pruneBackups({
    backupsDirectory,
    keepDays: 7,
    now: () => now,
    removeFile: () => {
      throw new Error("injected delete failure");
    },
  });

  const name = basename(expired.path);
  assert.deepEqual(result.deleted, []);
  assert.deepEqual(result.failed, [name]);
  assert.equal(existsSync(expired.path), true);
  assert.ok(readBackupManifestIndex(backupsDirectory)[name] !== undefined);
});
