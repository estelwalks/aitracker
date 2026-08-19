import assert from "node:assert/strict";
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import type { RuntimeVersionsProvider } from "./capability-probe.server.ts";
import { DatabaseHost } from "./database-host.server.ts";
import { NODE_SQLITE_CONNECTION_OPTIONS } from "./infrastructure/node-sqlite-database.server.ts";
import {
  checkIntegrity,
  quarantineCorruptDatabase,
  rollbackFaultGroup,
  setAsideFaultGroup,
} from "./integrity.server.ts";
import { readSchemaVersion, runMigrations } from "./migration-runner.server.ts";

/** Enough of node:test's TestContext for the shared test bed. */
interface TestScope {
  after(fn: () => void): void;
}

const APP_VERSION = "3.0.0-test";

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

function openMigratedDb(scope: TestScope): {
  host: DatabaseHost;
  directory: string;
  databasePath: string;
} {
  const directory = mkdtempSync(join(tmpdir(), "tt-db-integrity-"));
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

/** True only when the file can be opened and passes `quick_check`. */
function passesQuickCheck(path: string): boolean {
  let database: DatabaseSync;
  try {
    database = new DatabaseSync(path, {
      readOnly: true,
      readBigInts: true,
    });
  } catch {
    return false;
  }
  try {
    const rows = database.prepare("PRAGMA quick_check").all();
    return (
      rows.length > 0 &&
      rows.every((row) => String(Object.values(row)[0]).toLowerCase() === "ok")
    );
  } catch {
    return false;
  } finally {
    database.close();
  }
}

test("a clean database passes integrity and has no foreign-key violations", (t) => {
  const { host } = openMigratedDb(t);
  const result = checkIntegrity(host);
  assert.equal(result.integrityOk, true);
  assert.equal(result.foreignKeyViolations, 0);
  assert.equal(result.integrityMessage, undefined);
});

test("checkIntegrity reports foreign-key violations injected with foreign_keys=OFF", (t) => {
  const { host, databasePath } = openMigratedDb(t);

  // The Host asserts foreign_keys=ON, so create the orphan row through a raw
  // second connection that disables enforcement for its own writes only.
  const raw = new DatabaseSync(databasePath, NODE_SQLITE_CONNECTION_OPTIONS);
  try {
    raw.exec("PRAGMA foreign_keys=OFF");
    raw
      .prepare(
        "INSERT INTO ai_executions (request_id, capability, profile_id, prompt_version_id, prompt_version, status) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        "req-orphan",
        "report",
        "no-such-profile",
        "prompt-1",
        1,
        "completed",
      );
  } finally {
    raw.close();
  }

  const result = checkIntegrity(host);
  assert.equal(result.integrityOk, true, "page integrity is unaffected");
  assert.ok(
    result.foreignKeyViolations > 0,
    "the dangling profile_id must be reported by foreign_key_check",
  );
});

test("quarantineCorruptDatabase moves the db/-wal/-shm fault group and allows a fresh reopen", (t) => {
  const { host, directory, databasePath } = openMigratedDb(t);
  host
    .prepare(
      "INSERT INTO runtime_flags (flag_key, value_json, updated_at_ms) VALUES (?, ?, ?)",
    )
    .run("flag", '"value"', 1);
  host.close(); // Release file locks before moving the fault group.

  // Corrupt the header so the database can no longer be opened.
  const descriptor = openSync(databasePath, "r+");
  try {
    writeSync(descriptor, Buffer.alloc(64, 0x5a), 0, 64, 0);
  } finally {
    closeSync(descriptor);
  }
  // Simulate crash leftovers that belong to the same fault group.
  writeFileSync(`${databasePath}-wal`, "leftover wal bytes");
  writeFileSync(`${databasePath}-shm`, "leftover shm bytes");

  assert.equal(
    passesQuickCheck(databasePath),
    false,
    "the corrupted database must fail quick_check",
  );

  const quarantineDirectory = quarantineCorruptDatabase(databasePath);

  assert.ok(quarantineDirectory.includes(".corrupt."));
  assert.equal(existsSync(databasePath), false);
  assert.equal(existsSync(`${databasePath}-wal`), false);
  assert.equal(existsSync(`${databasePath}-shm`), false);

  const name = basename(databasePath);
  assert.equal(existsSync(join(quarantineDirectory, name)), true);
  assert.equal(existsSync(join(quarantineDirectory, `${name}-wal`)), true);
  assert.equal(existsSync(join(quarantineDirectory, `${name}-shm`)), true);
  assert.equal(existsSync(join(dirname(databasePath), name)), false);

  // The same path can now be re-opened as a fresh, empty database.
  const reopened = DatabaseHost.open({
    path: databasePath,
    versionsProvider: versionsProvider(),
  });
  assert.equal(reopened.isOpen, true);
  assert.equal(readSchemaVersion(reopened), 0);
  reopened.close();
});

test("setAsideFaultGroup names the directory after the reason, not after corruption", (t) => {
  const { host, directory, databasePath } = openMigratedDb(t);
  host.close();

  // A database replaced by a *successful restore* is not corrupt, so the
  // directory must not claim it is.
  const replaced = setAsideFaultGroup(databasePath, {
    reason: "replaced-by-restore",
  });
  assert.equal(basename(replaced).startsWith(".replaced."), true);
  assert.equal(existsSync(join(replaced, basename(databasePath))), true);
  assert.equal(existsSync(databasePath), false);

  // The corruption path keeps the `.corrupt.*` name, via the convenience
  // wrapper and via the explicit reason.
  writeFileSync(databasePath, "recreated");
  const corrupt = setAsideFaultGroup(databasePath, { reason: "corrupt" });
  assert.equal(basename(corrupt).startsWith(".corrupt."), true);

  writeFileSync(databasePath, "recreated again");
  const wrapped = quarantineCorruptDatabase(databasePath);
  assert.equal(basename(wrapped).startsWith(".corrupt."), true);
  assert.notEqual(wrapped, corrupt, "each call reserves its own directory");
  assert.equal(
    readdirSync(directory).filter((name) => name.startsWith(".corrupt."))
      .length,
    2,
  );
});

test("rollbackFaultGroup moves the whole fault group back and removes the directory", (t) => {
  const { host, databasePath } = openMigratedDb(t);
  host.close();
  writeFileSync(`${databasePath}-wal`, "wal bytes");
  writeFileSync(`${databasePath}-shm`, "shm bytes");
  const before = readFileSync(databasePath);

  const setAside = setAsideFaultGroup(databasePath, {
    reason: "replaced-by-restore",
  });
  assert.equal(existsSync(databasePath), false);

  rollbackFaultGroup(setAside, databasePath);

  assert.deepEqual(readFileSync(databasePath), before);
  assert.equal(existsSync(`${databasePath}-wal`), true);
  assert.equal(existsSync(`${databasePath}-shm`), true);
  assert.equal(
    existsSync(setAside),
    false,
    "an emptied set-aside directory is removed",
  );

  // A rollback never overwrites a newer file at the original name, and never
  // deletes the set-aside copy either.
  const second = setAsideFaultGroup(databasePath, { reason: "corrupt" });
  writeFileSync(databasePath, "newer file");
  rollbackFaultGroup(second, databasePath);
  assert.equal(String(readFileSync(databasePath)), "newer file");
  assert.equal(existsSync(join(second, basename(databasePath))), true);
});

test("setAsideFaultGroup rolls already-moved members back when a later rename fails", (t) => {
  const { host, directory, databasePath } = openMigratedDb(t);
  host.close();
  writeFileSync(`${databasePath}-wal`, "wal bytes");
  writeFileSync(`${databasePath}-shm`, "shm bytes");
  const originalDatabase = readFileSync(databasePath);
  let calls = 0;

  assert.throws(
    () =>
      setAsideFaultGroup(databasePath, {
        reason: "corrupt",
        renameFile: (source, target) => {
          calls += 1;
          if (calls === 2) {
            const error = new Error("injected rename failure") as Error & {
              code: string;
            };
            error.code = "EACCES";
            throw error;
          }
          renameSync(source, target);
        },
      }),
    (error) =>
      error instanceof Error && error.message === "integrity:target-busy",
  );

  assert.deepEqual(readFileSync(databasePath), originalDatabase);
  assert.equal(existsSync(`${databasePath}-wal`), true);
  assert.equal(existsSync(`${databasePath}-shm`), true);
  assert.equal(
    readdirSync(directory).some((name) => name.startsWith(".corrupt.")),
    false,
  );
});
