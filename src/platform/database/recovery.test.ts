import assert from "node:assert/strict";
import {
  closeSync,
  existsSync,
  mkdirSync,
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
import {
  createOnlineBackup,
  MANIFEST_FILE_NAME,
  sha256OfFile,
} from "./backup.server.ts";
import { DatabaseError, TRUSTTOOLS_APPLICATION_ID } from "./contracts.ts";
import { DatabaseHost } from "./database-host.server.ts";
import { checkIntegrity } from "./integrity.server.ts";
import { readSchemaVersion, runMigrations } from "./migration-runner.server.ts";
import { MIGRATIONS } from "./migrations/index.ts";
import {
  createEmptyDatabaseWithMarker,
  planRecovery,
  RECOVERY_MARKER_FLAG_KEY,
  restoreFromBackup,
} from "./recovery.server.ts";

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

/** Reads/patches `manifest.json` the way a damaged or forged index would look. */
function patchManifest(
  backupsDirectory: string,
  mutate: (index: Record<string, Record<string, unknown>>) => void,
): void {
  const path = join(backupsDirectory, MANIFEST_FILE_NAME);
  const index = JSON.parse(readFileSync(path, "utf8")) as Record<
    string,
    Record<string, unknown>
  >;
  mutate(index);
  writeFileSync(path, `${JSON.stringify(index, null, 2)}\n`, "utf8");
}

/** Overwrites the first 64 bytes so the file can no longer be opened. */
function smashHeader(path: string): void {
  const descriptor = openSync(path, "r+");
  try {
    writeSync(descriptor, Buffer.alloc(64, 0x5a), 0, 64, 0);
  } finally {
    closeSync(descriptor);
  }
}

function directoriesStartingWith(directory: string, prefix: string): string[] {
  return readdirSync(directory).filter((name) => name.startsWith(prefix));
}

function isDatabaseError(code: string): (error: unknown) => boolean {
  return (error: unknown) =>
    error instanceof DatabaseError &&
    error.code === code &&
    !error.message.includes(tmpdir());
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
  const plan = planRecovery({ backupsDirectory });
  const after = readdirSync(backupsDirectory).sort();

  assert.equal(plan.kind, "backup-available");
  if (plan.kind !== "backup-available") return;
  assert.equal(plan.backup.path, backup.path);
  assert.deepEqual(plan.unverified, []);
  assert.deepEqual(after, before, "planRecovery must not modify disk state");

  // Restore to a fresh path: the source database is left alone, so nothing is
  // set aside and the backup must remain in place afterwards.
  const restoredPath = join(directory, "restored.db");
  const result = restoreFromBackup({
    databasePath: restoredPath,
    backupPath: backup.path,
    backupsDirectory,
    confirmedByUser: true,
  });
  assert.equal(result.databasePath, restoredPath);
  assert.equal(result.setAsideDirectory, undefined);
  assert.equal(
    existsSync(backup.path),
    true,
    "the backup is copied, not moved",
  );
  assert.equal(
    existsSync(`${restoredPath}.restore.tmp`),
    false,
    "the restore temporary file must be renamed away",
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

test("planRecovery reports no-backup with a reason and never confuses it with a corrupt manifest", async (t) => {
  const { host, directory } = openMigratedDb(t);

  // 1. The directory does not exist at all (typical first run).
  assert.deepEqual(
    planRecovery({ backupsDirectory: join(directory, "none") }),
    {
      kind: "no-backup",
      reason: "no-backups-directory",
      unverified: [],
    },
  );

  // 2. The directory exists but holds nothing that looks like a backup.
  const empty = join(directory, "empty-backups");
  mkdirSync(empty, { recursive: true });
  assert.deepEqual(planRecovery({ backupsDirectory: empty }), {
    kind: "no-backup",
    reason: "no-backup-files",
    unverified: [],
  });

  // 3. Files exist but none of them verifies: reported, not silently dropped.
  const backupsDirectory = join(directory, "backups");
  const backup = await createOnlineBackup({
    host,
    backupsDirectory,
    appVersion: APP_VERSION,
    sqliteVersion: SQLITE_VERSION,
  });
  smashHeader(backup.path);
  writeFileSync(join(backupsDirectory, "garbage.db"), "not a sqlite database");

  const plan = planRecovery({ backupsDirectory });
  assert.equal(plan.kind, "no-backup");
  if (plan.kind !== "no-backup") return;
  assert.equal(plan.reason, "no-verified-backup");
  assert.deepEqual(
    [...plan.unverified].sort((a, b) => a.path.localeCompare(b.path)),
    [
      { path: backup.path, reason: "quick-check-failed" },
      {
        path: join(backupsDirectory, "garbage.db"),
        reason: "no-manifest-record",
      },
    ].sort((a, b) => a.path.localeCompare(b.path)),
  );
});

test("planRecovery reports manifest-corrupt instead of pretending there are no backups", async (t) => {
  const { host, directory } = openMigratedDb(t);
  const backupsDirectory = join(directory, "backups");
  const backup = await createOnlineBackup({
    host,
    backupsDirectory,
    appVersion: APP_VERSION,
    sqliteVersion: SQLITE_VERSION,
  });
  writeFileSync(join(backupsDirectory, MANIFEST_FILE_NAME), "{ not json", {
    encoding: "utf8",
  });

  assert.deepEqual(planRecovery({ backupsDirectory }), {
    kind: "manifest-corrupt",
    backupsDirectory,
  });
  assert.equal(
    existsSync(backup.path),
    true,
    "an intact backup file must survive a damaged manifest",
  );
});

test("restoreFromBackup recovers a corrupted database and keeps the replaced file in .replaced.*", async (t) => {
  const { host, directory, databasePath } = openMigratedDb(t);
  const backupsDirectory = join(directory, "backups");
  insertFlag(host, "flag", '"recover-me"');
  const backup = await createOnlineBackup({
    host,
    backupsDirectory,
    appVersion: APP_VERSION,
    sqliteVersion: SQLITE_VERSION,
  });
  host.close(); // Release file locks before the fault group can be moved.

  smashHeader(databasePath);

  const result = restoreFromBackup({
    databasePath,
    backupPath: backup.path,
    backupsDirectory,
    confirmedByUser: true,
  });
  assert.equal(result.databasePath, databasePath);
  assert.ok(result.setAsideDirectory?.includes(".replaced."));

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

  // The replaced original is retained under a neutral `.replaced.*` name — it
  // was replaced by a restore, so calling it `.corrupt.*` would misreport it.
  const setAside = directoriesStartingWith(directory, ".replaced.");
  assert.equal(setAside.length, 1);
  assert.equal(directoriesStartingWith(directory, ".corrupt.").length, 0);
  assert.equal(
    existsSync(join(directory, setAside[0], basename(databasePath))),
    true,
    "the replaced database must be moved, not deleted",
  );
  assert.equal(existsSync(backup.path), true, "the backup must remain intact");
  reopened.close();
});

test("restoreFromBackup refuses an unconfirmed restore and leaves the database untouched", async (t) => {
  const { host, directory, databasePath } = openMigratedDb(t);
  const backupsDirectory = join(directory, "backups");
  insertFlag(host, "flag", '"live"');
  const backup = await createOnlineBackup({
    host,
    backupsDirectory,
    appVersion: APP_VERSION,
    sqliteVersion: SQLITE_VERSION,
  });

  assert.throws(
    () =>
      restoreFromBackup({
        databasePath,
        backupPath: backup.path,
        backupsDirectory,
        confirmedByUser: false,
      }),
    isDatabaseError("invalid-argument"),
  );
  assert.equal(directoriesStartingWith(directory, ".replaced.").length, 0);
  assert.equal(readFlag(host, "flag"), '"live"');
});

test("restoreFromBackup rejects every backup path outside the backups directory", async (t) => {
  const { host, directory, databasePath } = openMigratedDb(t);
  const backupsDirectory = join(directory, "backups");
  const backup = await createOnlineBackup({
    host,
    backupsDirectory,
    appVersion: APP_VERSION,
    sqliteVersion: SQLITE_VERSION,
  });
  const name = basename(backup.path);
  const nested = join(backupsDirectory, "nested");
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, name), readFileSync(backup.path));

  const escapes = [
    join(backupsDirectory, "..", name), // parent-directory escape
    join(backupsDirectory, "..", "..", name), // deeper escape
    join(nested, name), // inside, but not a direct child
    join(directory, "platform.db"), // unrelated absolute path
  ];
  for (const backupPath of escapes) {
    assert.throws(
      () =>
        restoreFromBackup({
          databasePath: join(directory, "restored.db"),
          backupPath,
          backupsDirectory,
          confirmedByUser: true,
        }),
      isDatabaseError("invalid-argument"),
      `escape must be rejected: ${backupPath}`,
    );
  }
  assert.equal(existsSync(join(directory, "restored.db")), false);
  assert.equal(existsSync(databasePath), true);
});

test("restoreFromBackup requires a manifest record for the chosen file", async (t) => {
  const { host, directory } = openMigratedDb(t);
  const backupsDirectory = join(directory, "backups");
  const backup = await createOnlineBackup({
    host,
    backupsDirectory,
    appVersion: APP_VERSION,
    sqliteVersion: SQLITE_VERSION,
  });

  // A byte-identical copy of a *verified* backup is still not restorable: the
  // manifest record is the only trusted source of its SHA-256.
  const unrecorded = join(backupsDirectory, "trusttools-19990101-000000.db");
  writeFileSync(unrecorded, readFileSync(backup.path));

  assert.throws(
    () =>
      restoreFromBackup({
        databasePath: join(directory, "restored.db"),
        backupPath: unrecorded,
        backupsDirectory,
        confirmedByUser: true,
      }),
    isDatabaseError("not-found"),
  );
  assert.equal(existsSync(join(directory, "restored.db")), false);
});

test("restoreFromBackup rejects a database that is not a migrated AITracker database", async (t) => {
  const { directory } = openMigratedDb(t);
  const backupsDirectory = join(directory, "backups");
  mkdirSync(backupsDirectory, { recursive: true });

  // A perfectly healthy SQLite file with someone else's schema.
  const foreign = join(backupsDirectory, "trusttools-20200101-000000.db");
  const raw = new DatabaseSync(foreign);
  try {
    raw.exec("CREATE TABLE other (id INTEGER PRIMARY KEY)");
  } finally {
    raw.close();
  }
  writeFileSync(
    join(backupsDirectory, MANIFEST_FILE_NAME),
    `${JSON.stringify(
      {
        [basename(foreign)]: {
          schemaVersion: 1,
          appVersion: APP_VERSION,
          sqliteVersion: SQLITE_VERSION,
          sizeBytes: statSync(foreign).size,
          sha256: sha256OfFile(foreign),
          createdAtMs: 1,
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  assert.throws(
    () =>
      restoreFromBackup({
        databasePath: join(directory, "restored.db"),
        backupPath: foreign,
        backupsDirectory,
        confirmedByUser: true,
      }),
    isDatabaseError("invalid-argument"),
  );
  assert.equal(existsSync(join(directory, "restored.db")), false);
  assert.equal(existsSync(join(directory, "restored.db.restore.tmp")), false);
});

test("restoreFromBackup rejects a foreign application_id and accepts the AITracker value", async (t) => {
  const { host, directory } = openMigratedDb(t);
  const backupsDirectory = join(directory, "backups");
  const backup = await createOnlineBackup({
    host,
    backupsDirectory,
    appVersion: APP_VERSION,
    sqliteVersion: SQLITE_VERSION,
  });

  const stamp = (applicationId: number): void => {
    const raw = new DatabaseSync(backup.path);
    try {
      raw.exec(`PRAGMA application_id = ${applicationId}`);
    } finally {
      raw.close();
    }
    patchManifest(backupsDirectory, (index) => {
      index[basename(backup.path)].sha256 = sha256OfFile(backup.path);
      index[basename(backup.path)].sizeBytes = statSync(backup.path).size;
    });
  };

  stamp(0x0badf00d);
  assert.throws(
    () =>
      restoreFromBackup({
        databasePath: join(directory, "restored.db"),
        backupPath: backup.path,
        backupsDirectory,
        confirmedByUser: true,
      }),
    isDatabaseError("invalid-argument"),
  );

  // The value migration 0001 will eventually stamp is accepted.
  stamp(TRUSTTOOLS_APPLICATION_ID);
  const result = restoreFromBackup({
    databasePath: join(directory, "restored.db"),
    backupPath: backup.path,
    backupsDirectory,
    confirmedByUser: true,
  });
  assert.equal(result.databasePath, join(directory, "restored.db"));
});

test("restoreFromBackup rejects a ledger that diverges from the known migrations", async (t) => {
  const { host, directory } = openMigratedDb(t);
  const backupsDirectory = join(directory, "backups");
  const backup = await createOnlineBackup({
    host,
    backupsDirectory,
    appVersion: APP_VERSION,
    sqliteVersion: SQLITE_VERSION,
  });

  // Same version + name, different SQL text: the backup was produced by another
  // lineage and must not be installed.
  assert.throws(
    () =>
      restoreFromBackup({
        databasePath: join(directory, "restored.db"),
        backupPath: backup.path,
        backupsDirectory,
        confirmedByUser: true,
        definitions: [
          { ...MIGRATIONS[0], sql: `${MIGRATIONS[0].sql}\n-- divergent\n` },
        ],
      }),
    isDatabaseError("migration-checksum"),
  );

  // A version this build does not know at all is a foreign lineage.
  assert.throws(
    () =>
      restoreFromBackup({
        databasePath: join(directory, "restored.db"),
        backupPath: backup.path,
        backupsDirectory,
        confirmedByUser: true,
        definitions: [{ ...MIGRATIONS[0], version: 7 }],
      }),
    isDatabaseError("migration-reverted"),
  );
  assert.equal(existsSync(join(directory, "restored.db")), false);
});

test("a restore that fails validation compensates and leaves the live database in place", async (t) => {
  const { host, directory, databasePath } = openMigratedDb(t);
  const backupsDirectory = join(directory, "backups");
  insertFlag(host, "flag", '"live"');
  const backup = await createOnlineBackup({
    host,
    backupsDirectory,
    appVersion: APP_VERSION,
    sqliteVersion: SQLITE_VERSION,
  });
  // The manifest now claims a different SHA-256 than the file really has.
  patchManifest(backupsDirectory, (index) => {
    index[basename(backup.path)].sha256 = "0".repeat(64);
  });
  host.close();

  assert.throws(
    () =>
      restoreFromBackup({
        databasePath,
        backupPath: backup.path,
        backupsDirectory,
        confirmedByUser: true,
      }),
    isDatabaseError("integrity-check-failed"),
  );

  assert.equal(
    existsSync(`${databasePath}.restore.tmp`),
    false,
    "the temporary copy must be removed",
  );
  assert.equal(
    directoriesStartingWith(directory, ".replaced.").length,
    0,
    "nothing may be moved aside before validation passes",
  );
  const reopened = DatabaseHost.open({
    path: databasePath,
    versionsProvider: versionsProvider(),
  });
  t.after(() => reopened.close());
  assert.equal(readFlag(reopened, "flag"), '"live"');
  reopened.close();
});

test("createEmptyDatabaseWithMarker sets a corrupt database aside and marks the fresh one", (t) => {
  const { host, directory, databasePath } = openMigratedDb(t);
  insertFlag(host, "flag", '"doomed"');
  host.close();
  smashHeader(databasePath);
  writeFileSync(`${databasePath}-wal`, "leftover wal bytes");

  const result = createEmptyDatabaseWithMarker({
    databasePath,
    appVersion: APP_VERSION,
    versionsProvider: versionsProvider(),
    reason: "no-verified-backup",
    domains: ["reports", "knowledge"],
    now: () => 1_700_000_000_000,
  });

  assert.equal(result.databasePath, databasePath);
  assert.equal(result.schemaVersion, 1);
  assert.deepEqual(result.marker, {
    createdAtMs: 1_700_000_000_000,
    reason: "no-verified-backup",
    domains: ["reports", "knowledge"],
  });
  assert.ok(result.setAsideDirectory?.includes(".corrupt."));
  assert.equal(
    existsSync(join(result.setAsideDirectory ?? "", basename(databasePath))),
    true,
    "the corrupt database is kept as evidence",
  );

  const reopened = DatabaseHost.open({
    path: databasePath,
    versionsProvider: versionsProvider(),
  });
  t.after(() => reopened.close());
  assert.equal(readSchemaVersion(reopened), 1);
  assert.equal(readFlag(reopened, "flag"), undefined, "the DB is empty");
  const marker = readFlag(reopened, RECOVERY_MARKER_FLAG_KEY);
  assert.ok(marker !== undefined);
  assert.deepEqual(JSON.parse(marker), {
    createdAtMs: 1_700_000_000_000,
    reason: "no-verified-backup",
    domains: ["reports", "knowledge"],
  });
  assert.equal(
    marker.includes(directory),
    false,
    "the marker must not record any path",
  );
  assert.equal(checkIntegrity(reopened).integrityOk, true);
  reopened.close();
});

test("createEmptyDatabaseWithMarker refuses path-shaped domains and unknown reasons", (t) => {
  const { host, directory } = openMigratedDb(t);
  host.close();
  const databasePath = join(directory, "fresh.db");

  for (const domains of [
    ["C:\\Users\\someone\\reports"],
    ["/home/someone/reports"],
    ["reports/2024"],
    [".."],
    [""],
  ]) {
    assert.throws(
      () =>
        createEmptyDatabaseWithMarker({
          databasePath,
          appVersion: APP_VERSION,
          versionsProvider: versionsProvider(),
          reason: "no-backup-files",
          domains,
        }),
      isDatabaseError("invalid-argument"),
      `domain must be rejected: ${domains[0]}`,
    );
  }
  assert.throws(
    () =>
      createEmptyDatabaseWithMarker({
        databasePath,
        appVersion: APP_VERSION,
        versionsProvider: versionsProvider(),
        // @ts-expect-error deliberately outside the reason union
        reason: "because",
      }),
    isDatabaseError("invalid-argument"),
  );
  assert.equal(
    existsSync(databasePath),
    false,
    "a rejected call must not create a database",
  );
});
