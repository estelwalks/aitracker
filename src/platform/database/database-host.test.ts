import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  NodeRuntimeVersionsProvider,
  SQLITE_BASELINE_VERSION,
  compareSqliteVersions,
  evaluateCapabilities,
  parseSqliteVersion,
  probeWalCapability,
  type RuntimeVersionsProvider,
} from "./capability-probe.server.ts";
import { DatabaseError, TRUSTTOOLS_APPLICATION_ID } from "./index.ts";
import type {
  SqliteDatabasePort,
  SqliteRow,
  SqliteStatement,
  Transaction,
} from "./index.ts";
import {
  DatabaseHost,
  capabilityFailureCode,
  normalizePragmaValue,
  type DatabaseHostOptions,
} from "./database-host.server.ts";

/** Enough of node:test's TestContext for our helpers. */
interface TestScope {
  after(fn: () => void): void;
}

function versionsProvider(sqliteVersion: string): RuntimeVersionsProvider {
  return {
    getVersions: () => ({
      nodeVersion: "24.9.0",
      sqliteVersion,
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

/** Registers the close hook before the directory cleanup so cleanup runs last. */
function openHostInDir(
  scope: TestScope,
  dir: string,
  fileName: string,
  provider: RuntimeVersionsProvider,
  adapterFactory?: DatabaseHostOptions["adapterFactory"],
): DatabaseHost {
  const host = DatabaseHost.open({
    path: join(dir, fileName),
    versionsProvider: provider,
    adapterFactory,
  });
  scope.after(() => host.close());
  scope.after(() => rmTempDir(dir));
  return host;
}

function pragmaValue(port: SqliteDatabasePort, sql: string): string {
  const row = port.prepare(sql).get();
  return normalizePragmaValue(
    row === undefined ? undefined : Object.values(row)[0],
  );
}

function readWindowsAcl(path: string): string {
  const result = spawnSync("icacls", [path], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(
    result.status,
    0,
    `icacls failed for ${path}: ${result.stderr || result.stdout}`,
  );
  return `${result.stdout}\n${result.stderr}`;
}

/**
 * The canonical form a Host registers itself under, computed from the
 * filesystem instead of from the Host: `realpath` (which resolves symlinks such
 * as macOS `/var` → `/private/var`) plus Windows case folding.
 */
function canonical(path: string): string {
  const real = realpathSync.native(resolve(path));
  return process.platform === "win32" ? real.toLowerCase() : real;
}

test("NodeRuntimeVersionsProvider reads real runtime versions without a persistent connection", () => {
  const provider = new NodeRuntimeVersionsProvider();
  const versions = provider.getVersions();
  assert.equal(versions.nodeVersion, process.versions.node);
  assert.match(versions.sqliteVersion, /^\d+\.\d+\.\d+/);
  // The provider is injectable and falls back to the live query by default.
  const injected = new NodeRuntimeVersionsProvider({
    sqliteVersionSource: () => "3.52.0",
  });
  assert.equal(injected.getVersions().sqliteVersion, "3.52.0");
});

test("parseSqliteVersion parses major.minor.patch numerically", () => {
  assert.deepEqual(parseSqliteVersion("3.53.1"), {
    major: 3,
    minor: 53,
    patch: 1,
  });
  assert.deepEqual(parseSqliteVersion("3.50.4-suffix"), {
    major: 3,
    minor: 50,
    patch: 4,
  });
  assert.equal(parseSqliteVersion("not-a-version"), null);
  assert.equal(parseSqliteVersion(""), null);
});

test("compareSqliteVersions compares numerically by major.minor.patch", () => {
  assert.equal(compareSqliteVersions("3.53.1", "3.53.1"), 0);
  assert.equal(compareSqliteVersions("3.50.4", "3.53.1"), -1);
  assert.equal(compareSqliteVersions("3.53.1", "3.50.4"), 1);
  assert.equal(compareSqliteVersions("4.0.0", "3.99.99"), 1);
  // "3.9.0" must sort before "3.10.0": comparison is numeric, not lexical.
  assert.equal(compareSqliteVersions("3.9.0", "3.10.0"), -1);
  assert.equal(compareSqliteVersions("garbage", "3.53.1"), null);
  assert.equal(compareSqliteVersions("3.53.1", "garbage"), null);
});

test("evaluateCapabilities accepts a baseline-compliant runtime with a wal probe", () => {
  const evaluation = evaluateCapabilities(
    versionsProvider(SQLITE_BASELINE_VERSION).getVersions(),
    { journalMode: "wal" },
  );
  assert.equal(evaluation.supported, true);
  assert.equal(evaluation.failureReason, null);
});

test("evaluateCapabilities rejects low and unparseable sqlite versions and non-wal probes", () => {
  for (const low of ["3.52.9", "3.50.4", "3.0.0"]) {
    const evaluation = evaluateCapabilities(
      versionsProvider(low).getVersions(),
      {
        journalMode: "wal",
      },
    );
    assert.equal(evaluation.supported, false);
    assert.equal(evaluation.failureReason, "sqlite-below-baseline");
  }
  assert.equal(
    evaluateCapabilities(versionsProvider("garbage").getVersions(), {
      journalMode: "wal",
    }).failureReason,
    "sqlite-version-unparseable",
  );
  assert.equal(
    evaluateCapabilities(versionsProvider("3.60.0").getVersions(), {
      journalMode: "delete",
    }).failureReason,
    "wal-unavailable",
  );
});

test("probeWalCapability reports wal on a real file-backed probe and cleans up", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "tt-db-host-"));
  t.after(() => rmTempDir(dir));
  const probe = probeWalCapability(dir);
  assert.equal(probe.journalMode, "wal");
  const leftovers = readdirSync(dir).filter((name) =>
    name.includes("trusttools-wal-probe"),
  );
  assert.deepEqual(leftovers, []);
});

test("opens a file database and asserts every required pragma", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "tt-db-host-"));
  t.after(() => rmTempDir(dir));
  const host = openHostInDir(t, dir, "host.db", versionsProvider("99.0.0"));

  assert.equal(host.isOpen, true);
  assert.equal(host.path, canonical(join(dir, "host.db")));
  assert.equal(pragmaValue(host, "PRAGMA journal_mode"), "wal");
  assert.equal(pragmaValue(host, "PRAGMA synchronous"), "2");
  assert.equal(pragmaValue(host, "PRAGMA foreign_keys"), "1");
  assert.equal(pragmaValue(host, "PRAGMA busy_timeout"), "5000");
  assert.equal(pragmaValue(host, "PRAGMA trusted_schema"), "0");
  assert.equal(pragmaValue(host, "PRAGMA wal_autocheckpoint"), "1000");
  assert.equal(existsSync(host.path), true);
});

test("maps a wal-unavailable probe to journal-not-wal (P2-10)", () => {
  assert.equal(capabilityFailureCode("wal-unavailable"), "journal-not-wal");
  assert.equal(
    capabilityFailureCode("sqlite-below-baseline"),
    "capability-mismatch",
  );
  assert.equal(
    capabilityFailureCode("sqlite-version-unparseable"),
    "capability-mismatch",
  );
  assert.equal(capabilityFailureCode(null), "capability-mismatch");
});

test("checkpoint returns the wal_checkpoint columns on a file database (P2-8)", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "tt-db-host-"));
  const host = openHostInDir(t, dir, "host.db", versionsProvider("99.0.0"));
  const result = host.checkpoint("passive");
  assert.equal(typeof result.busy, "boolean");
  assert.equal(Number.isSafeInteger(result.logFrames), true);
  assert.equal(Number.isSafeInteger(result.checkpointedFrames), true);
  // TRUNCATE is also accepted; on an idle database it checkpoints cleanly.
  const truncated = host.checkpoint("truncate");
  assert.equal(typeof truncated.busy, "boolean");
});

test("rejects a database with a foreign application_id as capability-mismatch (P1-4)", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "tt-db-host-"));
  const dbPath = join(dir, "foreign.db");
  // Create a real SQLite file stamped with a foreign application_id.
  const raw = new DatabaseSync(dbPath);
  try {
    raw.exec("CREATE TABLE t (x INTEGER) STRICT");
    raw.exec("PRAGMA application_id = 305419896"); // 0x12345678
  } finally {
    raw.close();
  }
  t.after(() => rmTempDir(dir));

  assert.throws(
    () =>
      DatabaseHost.open({
        path: dbPath,
        versionsProvider: versionsProvider("99.0.0"),
      }),
    (error) =>
      error instanceof DatabaseError &&
      error.code === "capability-mismatch" &&
      error.operation === "open",
  );

  // Merely forging the AITracker stamp is insufficient: the schema identity
  // also requires a complete migration ledger and matching user_version.
  const stamped = new DatabaseSync(dbPath);
  try {
    stamped.exec(`PRAGMA application_id = ${TRUSTTOOLS_APPLICATION_ID}`);
  } finally {
    stamped.close();
  }
  assert.throws(
    () =>
      DatabaseHost.open({
        path: dbPath,
        versionsProvider: versionsProvider("99.0.0"),
      }),
    (error) =>
      error instanceof DatabaseError && error.code === "migration-reverted",
  );
});

test("file-backed database artifacts use platform-private permissions", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "tt-db-host-"));
  const host = openHostInDir(t, dir, "private.db", versionsProvider("99.0.0"));

  if (process.platform === "win32") {
    for (const artifact of [dir, host.path, `${host.path}.writer.lock`]) {
      const acl = readWindowsAcl(artifact);
      assert.match(acl, /NT AUTHORITY\\SYSTEM:.*\(F\)/i);
      assert.match(acl, /BUILTIN\\Administrators:.*\(F\)/i);
      assert.doesNotMatch(
        acl,
        /(?:Everyone|BUILTIN\\Users|Authenticated Users):.*\((?:F|M)\)/i,
        `broad principals must not have write access: ${acl}`,
      );
    }
    return;
  }

  assert.equal(statSync(dir).mode & 0o777, 0o700);
  assert.equal(statSync(host.path).mode & 0o777, 0o600);
  assert.equal(statSync(`${host.path}.writer.lock`).mode & 0o777, 0o600);
});

test("rejects an unstamped SQLite file that already contains user schema", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "tt-db-host-"));
  const dbPath = join(dir, "foreign-unstamped.db");
  const raw = new DatabaseSync(dbPath);
  try {
    raw.exec("CREATE TABLE foreign_data (id INTEGER PRIMARY KEY) STRICT");
    const applicationId = raw.prepare("PRAGMA application_id").get();
    assert.ok(applicationId !== undefined);
    assert.equal(Number(applicationId.application_id), 0);
  } finally {
    raw.close();
  }
  t.after(() => rmTempDir(dir));

  assert.throws(
    () =>
      DatabaseHost.open({
        path: dbPath,
        versionsProvider: versionsProvider("99.0.0"),
      }),
    (error) =>
      error instanceof DatabaseError &&
      error.code === "capability-mismatch" &&
      error.operation === "open",
  );
});

test("a second process cannot acquire the writer while this process owns it", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "tt-db-host-"));
  const dbPath = join(dir, "cross-process.db");
  const host = openHostInDir(
    t,
    dir,
    "cross-process.db",
    versionsProvider("99.0.0"),
  );
  const script = `
    const { DatabaseHost } = await import('./src/platform/database/database-host.server.ts');
    try {
      DatabaseHost.open({ path: process.argv[1], versionsProvider: { getVersions: () => ({ nodeVersion: '24.19.0', sqliteVersion: '99.0.0' }) } });
      process.exitCode = 2;
    } catch (error) {
      process.exitCode = error?.code === 'already-open' ? 0 : 3;
    }
  `;
  const child = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script, dbPath],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(child.status, 0, child.stderr || child.stdout);
  assert.equal(host.isOpen, true);
});

test("a stale writer lock is atomically reclaimed", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "tt-db-host-"));
  const dbPath = join(dir, "stale.db");
  writeFileSync(
    `${dbPath}.writer.lock`,
    `${JSON.stringify({ pid: 2_147_483_647, token: "dead", createdAtMs: 1 })}\n`,
  );
  const host = openHostInDir(t, dir, "stale.db", versionsProvider("99.0.0"));
  assert.equal(host.isOpen, true);
});

test("a child process releases writer ownership on normal process exit", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "tt-db-host-"));
  const dbPath = join(dir, "child-exit.db");
  t.after(() => rmTempDir(dir));
  const script = `
    const { DatabaseHost } = await import('./src/platform/database/database-host.server.ts');
    DatabaseHost.open({ path: process.argv[1], versionsProvider: { getVersions: () => ({ nodeVersion: '24.19.0', sqliteVersion: '99.0.0' }) } });
  `;
  const child = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script, dbPath],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(child.status, 0, child.stderr || child.stdout);
  assert.equal(existsSync(`${dbPath}.writer.lock`), false);
  const host = DatabaseHost.open({
    path: dbPath,
    versionsProvider: versionsProvider("99.0.0"),
  });
  t.after(() => host.close());
  assert.equal(host.isOpen, true);
});

test("creates missing parent directories before probing and opening a file database", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "tt-db-host-"));
  const nestedPath = join(dir, "level-one", "level-two", "nested.db");
  const host = DatabaseHost.open({
    path: nestedPath,
    versionsProvider: versionsProvider("99.0.0"),
  });
  t.after(() => host.close());
  t.after(() => rmTempDir(dir));

  assert.equal(host.isOpen, true);
  assert.equal(existsSync(nestedPath), true);
  assert.equal(pragmaValue(host, "PRAGMA journal_mode"), "wal");
});

test("rejects a second open of the same absolute path with already-open", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "tt-db-host-"));
  const host = openHostInDir(t, dir, "host.db", versionsProvider("99.0.0"));
  const aliased = join(dir, "sub", "..", "host.db");
  assert.throws(
    () =>
      DatabaseHost.open({
        path: aliased,
        versionsProvider: versionsProvider("99.0.0"),
      }),
    (error) =>
      error instanceof DatabaseError &&
      error.code === "already-open" &&
      error.operation === "open",
  );
});

test("close releases the singleton so the same path can be reopened", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "tt-db-host-"));
  const host = openHostInDir(t, dir, "host.db", versionsProvider("99.0.0"));
  host.close();
  assert.equal(host.isOpen, false);
  const reopened = openHostInDir(t, dir, "host.db", versionsProvider("99.0.0"));
  assert.equal(reopened.isOpen, true);
});

test("close keeps ownership after a close failure and releases it only on a later successful teardown", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "tt-db-host-"));
  t.after(() => rmTempDir(dir));
  let attempts = 0;
  const host = DatabaseHost.open({
    path: join(dir, "close-failure.db"),
    versionsProvider: versionsProvider("99.0.0"),
    adapterFactory: () =>
      new FakeAdapter(OK_PRAGMAS, () => {
        attempts += 1;
        if (attempts === 1) throw new DatabaseError("busy", "close");
      }),
  });
  assert.throws(
    () => host.close(),
    (error) => error instanceof DatabaseError,
  );
  assert.throws(
    () =>
      DatabaseHost.open({
        path: join(dir, "close-failure.db"),
        versionsProvider: versionsProvider("99.0.0"),
      }),
    (error) => error instanceof DatabaseError && error.code === "already-open",
  );
  host.close();
});

test("close refuses to release ownership while an asynchronous backup borrow is active", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "tt-db-host-"));
  const host = openHostInDir(t, dir, "borrow.db", versionsProvider("99.0.0"));
  let finish!: () => void;
  const pending = host.withUnderlyingConnection(
    () => new Promise<void>((resolve) => (finish = resolve)),
  );
  assert.throws(
    () => host.close(),
    (error) => error instanceof DatabaseError && error.code === "busy",
  );
  finish();
  await pending;
  host.close();
});

test("a case-alias of an open database cannot obtain a second writable connection", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "tt-db-host-"));
  const host = openHostInDir(t, dir, "platform.db", versionsProvider("99.0.0"));
  const aliasPath = join(dir, "PLATFORM.DB");

  // `PLATFORM.DB` resolving to the same file is a property of the filesystem,
  // not of the platform: Windows is always case-insensitive, macOS usually is,
  // and ext4 is not.
  const caseInsensitive = existsSync(aliasPath);
  if (process.platform === "win32") {
    assert.equal(
      caseInsensitive,
      true,
      "Windows filesystems are case-insensitive",
    );
  }

  if (caseInsensitive) {
    assert.throws(
      () =>
        DatabaseHost.open({
          path: aliasPath,
          versionsProvider: versionsProvider("99.0.0"),
        }),
      (error) =>
        error instanceof DatabaseError &&
        error.code === "already-open" &&
        error.operation === "open",
    );
  } else {
    // On a case-sensitive filesystem the alias is a genuinely different file;
    // what must still hold is that the key is the canonical real path.
    assert.equal(host.path, canonical(join(dir, "platform.db")));
    const aliased = DatabaseHost.open({
      path: aliasPath,
      versionsProvider: versionsProvider("99.0.0"),
    });
    t.after(() => aliased.close());
    assert.notEqual(aliased.path, host.path);
  }
});

test("an empty path is rejected instead of silently becoming an in-memory database", () => {
  for (const path of ["", "   "]) {
    assert.throws(
      () =>
        DatabaseHost.open({
          path,
          versionsProvider: versionsProvider("99.0.0"),
        }),
      (error) =>
        error instanceof DatabaseError &&
        error.code === "invalid-argument" &&
        error.operation === "open",
    );
  }
});

test("a closed Host reports not-open instead of forwarding to a dead connection", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "tt-db-host-"));
  const host = openHostInDir(t, dir, "host.db", versionsProvider("99.0.0"));
  host.close();
  for (const use of [
    () => host.prepare("SELECT 1"),
    () => host.exec("SELECT 1"),
    () => host.transaction(),
    () => host.withUnderlyingConnection(() => undefined),
  ]) {
    assert.throws(
      use,
      (error) => error instanceof DatabaseError && error.code === "not-open",
    );
  }
});

test("withUnderlyingConnection borrows the Host's own connection, not a second one", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "tt-db-host-"));
  const host = openHostInDir(t, dir, "host.db", versionsProvider("99.0.0"));

  // `foreign_keys` is per-connection and the Host asserts it ON at open time; a
  // freshly opened second connection would report the SQLite default of 0.
  const borrowed = host.withUnderlyingConnection((database) =>
    normalizePragmaValue(
      Object.values(database.prepare("PRAGMA foreign_keys").get() ?? {})[0],
    ),
  );
  assert.equal(borrowed, "1");

  // Writes through the borrowed handle are the Host's own writes.
  host.exec("CREATE TABLE probe (id INTEGER PRIMARY KEY) STRICT");
  host.withUnderlyingConnection((database) => {
    database.exec("INSERT INTO probe (id) VALUES (7)");
  });
  assert.equal(
    Number(host.prepare("SELECT COUNT(*) AS n FROM probe").get()?.n),
    1,
  );
});

test("withUnderlyingConnection refuses a port that is not the strict adapter", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "tt-db-host-"));
  t.after(() => rmTempDir(dir));
  const host = openHostInDir(
    t,
    dir,
    "host.db",
    versionsProvider("99.0.0"),
    () => new FakeAdapter(OK_PRAGMAS),
  );
  assert.throws(
    () => host.withUnderlyingConnection(() => undefined),
    (error) =>
      error instanceof DatabaseError && error.code === "invalid-argument",
  );
});

test("a low injected sqlite version rejects the write path with capability-mismatch", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "tt-db-host-"));
  const dbPath = join(dir, "host.db");
  assert.throws(
    () =>
      DatabaseHost.open({
        path: dbPath,
        versionsProvider: versionsProvider("3.50.4"),
      }),
    (error) =>
      error instanceof DatabaseError &&
      error.code === "capability-mismatch" &&
      error.operation === "open",
  );
  // No database file was ever created and nothing stays open/registered:
  // the same path opens once an adequate version is injected.
  assert.equal(existsSync(dbPath), false);
  const host = openHostInDir(t, dir, "host.db", versionsProvider("99.0.0"));
  assert.equal(host.isOpen, true);
});

test("closes the connection when the journal assertion fails and returns journal-not-wal", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "tt-db-host-"));
  t.after(() => rmTempDir(dir));
  let closed = false;
  const factory: DatabaseHostOptions["adapterFactory"] = () =>
    new FakeAdapter(
      { "pragma journal_mode=wal": { journal_mode: "delete" } },
      () => {
        closed = true;
      },
    );
  assert.throws(
    () =>
      DatabaseHost.open({
        path: join(dir, "host.db"),
        versionsProvider: versionsProvider("99.0.0"),
        adapterFactory: factory,
      }),
    (error) =>
      error instanceof DatabaseError && error.code === "journal-not-wal",
  );
  assert.equal(
    closed,
    true,
    "the connection must be closed on assertion failure",
  );
});

test("closes the connection when a non-journal pragma assertion fails and returns capability-mismatch", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "tt-db-host-"));
  t.after(() => rmTempDir(dir));
  let closed = false;
  const factory: DatabaseHostOptions["adapterFactory"] = () =>
    new FakeAdapter(
      {
        ...OK_PRAGMAS,
        "pragma foreign_keys": { foreign_keys: 0n },
      },
      () => {
        closed = true;
      },
    );
  assert.throws(
    () =>
      DatabaseHost.open({
        path: join(dir, "host.db"),
        versionsProvider: versionsProvider("99.0.0"),
        adapterFactory: factory,
      }),
    (error) =>
      error instanceof DatabaseError && error.code === "capability-mismatch",
  );
  assert.equal(closed, true);
});

test("opens an in-memory database and accepts the memory journal mode", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "tt-db-host-"));
  const host = DatabaseHost.open({
    path: ":memory:",
    versionsProvider: versionsProvider("99.0.0"),
  });
  t.after(() => host.close());
  t.after(() => rmTempDir(dir));
  assert.equal(host.path, ":memory:");
  assert.equal(pragmaValue(host, "PRAGMA journal_mode"), "memory");
});

class FakeAdapter implements SqliteDatabasePort {
  isOpen = true;
  closed = false;

  constructor(
    private readonly pragmaRows: Readonly<Record<string, SqliteRow>>,
    private readonly onClose: () => void = () => undefined,
  ) {}

  prepare(sql: string): SqliteStatement {
    const row = this.pragmaRows[sql.toLowerCase()];
    if (row !== undefined) return fakeStatement(row);
    throw new DatabaseError("sql-error", "read");
  }

  exec(): void {
    // The pragma readbacks are simulated entirely through prepare().
  }

  transaction(): Transaction {
    throw new DatabaseError("invalid-argument", "transaction");
  }

  close(): void {
    this.isOpen = false;
    this.closed = true;
    this.onClose();
  }
}

/** Readbacks that satisfy every Host pragma assertion. */
const OK_PRAGMAS: Readonly<Record<string, SqliteRow>> = {
  "pragma journal_mode=wal": { journal_mode: "wal" },
  "pragma synchronous": { synchronous: 2n },
  "pragma wal_autocheckpoint": { wal_autocheckpoint: 1000n },
  "pragma foreign_keys": { foreign_keys: 1n },
  "pragma busy_timeout": { timeout: 5000n },
  "pragma trusted_schema": { trusted_schema: 0n },
  "pragma application_id": { application_id: 0n },
};

function fakeStatement(row: SqliteRow): SqliteStatement {
  return {
    get: () => row,
    all: () => [row],
    run: () => ({ changes: 0, lastInsertRowid: 0 }),
  };
}
