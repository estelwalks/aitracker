import assert from "node:assert/strict";
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readdirSync,
  rmSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";

import type { RuntimeVersionsProvider } from "./capability-probe.server.ts";
import { createOnlineBackup } from "./backup.server.ts";
import { DatabaseHost } from "./database-host.server.ts";
import { checkIntegrity } from "./integrity.server.ts";
import { readSchemaVersion, runMigrations } from "./migration-runner.server.ts";
import { planRecovery, restoreFromBackup } from "./recovery.server.ts";

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
  const directory = mkdtempSync(join(tmpdir(), "tt-db-recovery-"));
  const databasePath = join(directory, "platform.db");
  const host = DatabaseHost.open({
    path: databasePath,
    versionsProvider: versionsProvider(),
  });
  scope.after(() => host.close());
  scope.after(() => rmTempDir(directory));
  runMigrations({ database: host, appVersion: APP_VERSION });
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

test("planRecovery returns backup-available without touching disk, and restore copies without moving the backup", async (t) => {
  const { host, directory } = openMigratedDb(t);
  const backupsDirectory = join(directory, "backups");
  insertFlag(host, "flag", '"kept"');
  const backup = await createOnlineBackup({
    host,
    backupsDirectory,
    appVersion: APP_VERSION,
    sqliteVersion: SQLITE_VERSION,
  });

  const before = readdirSync(backupsDirectory).sort();
  const plan = planRecovery({
    databasePath: join(directory, "platform.db"),
    backupsDirectory,
    appVersion: APP_VERSION,
    sqliteVersion: SQLITE_VERSION,
  });
  const after = readdirSync(backupsDirectory).sort();

  assert.equal(plan.kind, "backup-available");
  if (plan.kind !== "backup-available") return;
  assert.equal(plan.backup.path, backup.path);
  assert.deepEqual(after, before, "planRecovery must not modify disk state");

  // Restore to a fresh path: the source database is left alone, so no
  // quarantine is needed and the backup must remain in place afterwards.
  const restoredPath = join(directory, "restored.db");
  const result = restoreFromBackup({
    databasePath: restoredPath,
    backupPath: backup.path,
    backupsDirectory,
  });
  assert.equal(result, restoredPath);
  assert.equal(
    existsSync(backup.path),
    true,
    "the backup is copied, not moved",
  );

  const restored = DatabaseHost.open({
    path: restoredPath,
    versionsProvider: versionsProvider(),
  });
  t.after(() => restored.close());
  assert.equal(readSchemaVersion(restored), 1);
  assert.equal(readFlag(restored, "flag"), '"kept"');
  const health = checkIntegrity(restored);
  assert.equal(health.integrityOk, true);
  assert.equal(health.foreignKeyViolations, 0);
  restored.close();
});

test("planRecovery returns no-backup when no verified backup exists", (t) => {
  const { directory, databasePath } = openMigratedDb(t);
  const emptyBackupsDirectory = join(directory, "backups");

  const plan = planRecovery({
    databasePath,
    backupsDirectory: emptyBackupsDirectory,
    appVersion: APP_VERSION,
    sqliteVersion: SQLITE_VERSION,
  });
  assert.deepEqual(plan, { kind: "no-backup" });
});

test("restoreFromBackup recovers a corrupted database and keeps the corrupt file quarantined", async (t) => {
  const { host, directory, databasePath } = openMigratedDb(t);
  const backupsDirectory = join(directory, "backups");
  insertFlag(host, "flag", '"recover-me"');
  const backup = await createOnlineBackup({
    host,
    backupsDirectory,
    appVersion: APP_VERSION,
    sqliteVersion: SQLITE_VERSION,
  });
  host.close(); // Release file locks before quarantine can move the files.

  // Corrupt the live database beyond recovery.
  const descriptor = openSync(databasePath, "r+");
  try {
    writeSync(descriptor, Buffer.alloc(64, 0x5a), 0, 64, 0);
  } finally {
    closeSync(descriptor);
  }

  const restoredPath = restoreFromBackup({
    databasePath,
    backupPath: backup.path,
    backupsDirectory,
  });
  assert.equal(restoredPath, databasePath);

  const reopened = DatabaseHost.open({
    path: databasePath,
    versionsProvider: versionsProvider(),
  });
  t.after(() => reopened.close());
  assert.equal(readSchemaVersion(reopened), 1);
  assert.equal(readFlag(reopened, "flag"), '"recover-me"');
  const health = checkIntegrity(reopened);
  assert.equal(health.integrityOk, true);
  assert.equal(health.foreignKeyViolations, 0);

  // The corrupted original is retained in a `.corrupt.*` directory.
  const quarantineDirectories = readdirSync(directory).filter((name) =>
    name.startsWith(".corrupt."),
  );
  assert.equal(quarantineDirectories.length, 1);
  assert.equal(
    existsSync(
      join(directory, quarantineDirectories[0], basename(databasePath)),
    ),
    true,
    "the corrupted database must be moved, not deleted",
  );
  assert.equal(existsSync(backup.path), true, "the backup must remain intact");
  reopened.close();
});
