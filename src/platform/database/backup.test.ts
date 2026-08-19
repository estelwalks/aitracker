import assert from "node:assert/strict";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  openSync,
  readdirSync,
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
  listVerifiedBackups,
  readBackupManifestIndex,
  sha256OfFile,
} from "./backup.server.ts";
import { readSchemaVersion, runMigrations } from "./migration-runner.server.ts";

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
  const directory = mkdtempSync(join(tmpdir(), "tt-db-backup-"));
  const databasePath = join(directory, "platform.db");
  const host = DatabaseHost.open({
    path: databasePath,
    versionsProvider: versionsProvider(),
  });
  scope.after(() => host.close());
  scope.after(() => rmTempDir(directory));
  const result = runMigrations({ database: host, appVersion: APP_VERSION });
  assert.equal(result.currentVersion, 1);
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
  assert.equal(backup.manifest.schemaVersion, 1);
  assert.equal(backup.manifest.appVersion, APP_VERSION);
  assert.equal(backup.manifest.sqliteVersion, SQLITE_VERSION);
  assert.equal(backup.manifest.sha256, sha256OfFile(backup.path));
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
  assert.equal(readSchemaVersion(restored), 1);
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

test("listVerifiedBackups returns only verified backups, excluding garbage and corrupted files", async (t) => {
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

  const listed = listVerifiedBackups(backupsDirectory);
  assert.deepEqual(
    listed.map((backup) => backup.path),
    [good.path],
    "only the intact, manifest-backed backup should be listed",
  );
  assert.equal(listed[0].manifest.sha256, sha256OfFile(good.path));
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
