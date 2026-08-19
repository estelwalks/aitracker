import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
import { DatabaseError } from "./index.ts";
import type {
  SqliteDatabasePort,
  SqliteRow,
  SqliteStatement,
  Transaction,
} from "./index.ts";
import {
  DatabaseHost,
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
    name.includes("dsh-wal-probe"),
  );
  assert.deepEqual(leftovers, []);
});

test("opens a file database and asserts every required pragma", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "tt-db-host-"));
  t.after(() => rmTempDir(dir));
  const host = openHostInDir(t, dir, "host.db", versionsProvider("99.0.0"));

  assert.equal(host.isOpen, true);
  assert.equal(host.path, resolve(join(dir, "host.db")));
  assert.equal(pragmaValue(host, "PRAGMA journal_mode"), "wal");
  assert.equal(pragmaValue(host, "PRAGMA synchronous"), "2");
  assert.equal(pragmaValue(host, "PRAGMA foreign_keys"), "1");
  assert.equal(pragmaValue(host, "PRAGMA busy_timeout"), "5000");
  assert.equal(pragmaValue(host, "PRAGMA trusted_schema"), "0");
  assert.equal(pragmaValue(host, "PRAGMA wal_autocheckpoint"), "1000");
  assert.equal(existsSync(host.path), true);
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
};

function fakeStatement(row: SqliteRow): SqliteStatement {
  return {
    get: () => row,
    all: () => [row],
    run: () => ({ changes: 0, lastInsertRowid: 0 }),
  };
}
