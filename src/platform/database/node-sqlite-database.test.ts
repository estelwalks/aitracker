import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { randomUUID } from "node:crypto";

import { DatabaseError } from "./index.ts";
import {
  NodeSqliteDatabase,
  bigintToSafeNumber,
  bigintToSafeString,
} from "./infrastructure/node-sqlite-database.server.ts";

/** Enough of node:test's TestContext for our helpers. */
interface TestScope {
  after(fn: () => void): void;
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
function openDbInDir(
  scope: TestScope,
  dir: string,
  fileName: string,
): NodeSqliteDatabase {
  const db = new NodeSqliteDatabase({ path: join(dir, fileName) });
  scope.after(() => db.close());
  scope.after(() => rmTempDir(dir));
  return db;
}

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "tt-db-sqlite-"));
}

test("opens a file database and executes statements", (t) => {
  const db = openDbInDir(t, freshDir(), "open.db");
  assert.equal(db.isOpen, true);
  db.exec(
    "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL) STRICT",
  );
  const insert = db.prepare("INSERT INTO items (name) VALUES (?)");
  insert.run("alpha");
  insert.run("beta");
  const rows = db.prepare("SELECT id, name FROM items ORDER BY id").all();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "alpha");
  assert.equal(rows[1].name, "beta");
  assert.equal(Number(insert.run("gamma").changes), 1);
});

test("binds anonymous and prefixed named parameters", (t) => {
  const db = openDbInDir(t, freshDir(), "bind.db");
  db.exec(
    "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL) STRICT",
  );
  db.prepare("INSERT INTO items (name) VALUES (:name)").run({ ":name": "one" });
  db.prepare("INSERT INTO items (name) VALUES (?)").run("two");
  const byName = db
    .prepare("SELECT id FROM items WHERE name = :name")
    .get({ ":name": "one" });
  assert.equal(byName?.id, 1n);
  const byAnon = db.prepare("SELECT id FROM items WHERE name = ?").get("two");
  assert.equal(byAnon?.id, 2n);
});

test("rejects bare named parameters (allowBareNamedParameters=false)", (t) => {
  const db = openDbInDir(t, freshDir(), "bare.db");
  db.exec(
    "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL) STRICT",
  );
  const statement = db.prepare("SELECT id FROM items WHERE name = :name");
  assert.throws(
    () => statement.get({ name: "one" }),
    (error) =>
      error instanceof DatabaseError && error.code === "invalid-argument",
  );
});

test("rejects unknown named parameters (allowUnknownNamedParameters=false)", (t) => {
  const db = openDbInDir(t, freshDir(), "unknown.db");
  db.exec(
    "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL) STRICT",
  );
  const statement = db.prepare("SELECT id FROM items WHERE name = :name");
  assert.throws(
    () => statement.get({ ":missing": 1 }),
    (error) =>
      error instanceof DatabaseError && error.code === "invalid-argument",
  );
});

test("bigint reads round-trip exactly and safe conversion rejects overflow", (t) => {
  const db = openDbInDir(t, freshDir(), "big.db");
  db.exec("CREATE TABLE counts (id INTEGER PRIMARY KEY, value INTEGER) STRICT");
  const insert = db.prepare("INSERT INTO counts (value) VALUES (?)");
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
  const minSafe = BigInt(Number.MIN_SAFE_INTEGER);
  insert.run(maxSafe);
  insert.run(minSafe);
  insert.run(maxSafe + 1n);
  insert.run(minSafe - 1n);

  const rows = db.prepare("SELECT value FROM counts ORDER BY id").all();
  assert.equal(
    bigintToSafeNumber(rows[0].value as bigint),
    Number.MAX_SAFE_INTEGER,
  );
  assert.equal(
    bigintToSafeNumber(rows[1].value as bigint),
    Number.MIN_SAFE_INTEGER,
  );
  assert.throws(
    () => bigintToSafeNumber(rows[2].value as bigint),
    (error) =>
      error instanceof DatabaseError && error.code === "integer-overflow",
  );
  assert.throws(
    () => bigintToSafeNumber(rows[3].value as bigint),
    (error) =>
      error instanceof DatabaseError && error.code === "integer-overflow",
  );
  // Lossless string conversion stays available for out-of-range counters.
  assert.equal(
    bigintToSafeString(rows[2].value as bigint),
    (maxSafe + 1n).toString(),
  );
});

test("transactions commit and roll back atomically", (t) => {
  const db = openDbInDir(t, freshDir(), "tx.db");
  db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT) STRICT");

  const rolledBack = db.transaction();
  rolledBack.begin();
  db.prepare("INSERT INTO items (name) VALUES (?)").run("rolled-back");
  rolledBack.rollback();
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM items").get()?.n, 0n);

  const committed = db.transaction();
  committed.begin();
  db.prepare("INSERT INTO items (name) VALUES (?)").run("committed");
  committed.commit();
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM items").get()?.n, 1n);
});

test("transaction misuse returns stable errors", (t) => {
  const db = openDbInDir(t, freshDir(), "tx-guard.db");
  const transaction = db.transaction();
  assert.throws(
    () => transaction.commit(),
    (error) =>
      error instanceof DatabaseError && error.code === "invalid-argument",
  );
  transaction.begin();
  assert.throws(
    () => transaction.begin(),
    (error) =>
      error instanceof DatabaseError && error.code === "invalid-argument",
  );
  transaction.commit();
  assert.throws(
    () => transaction.rollback(),
    (error) =>
      error instanceof DatabaseError && error.code === "invalid-argument",
  );
});

test("extensions cannot be loaded (allowExtension=false)", (t) => {
  const db = openDbInDir(t, freshDir(), "ext.db");
  assert.throws(
    () => db.exec("SELECT load_extension('nope')"),
    (error) => error instanceof DatabaseError,
  );
});

test("close marks the database closed and further use fails with a stable error", (t) => {
  const dir = freshDir();
  const db = openDbInDir(t, dir, "close.db");
  db.exec("CREATE TABLE t (x INTEGER) STRICT");
  db.close();
  assert.equal(db.isOpen, false);
  assert.throws(
    () => db.prepare("SELECT 1"),
    (error) => error instanceof DatabaseError && error.code === "sql-error",
  );
  // Double close is a no-op.
  db.close();
});

test("open failure maps to a stable DatabaseError without the path in the message", () => {
  const missing = join(
    tmpdir(),
    `tt-db-missing-${process.pid}-${randomUUID()}`,
    "missing.db",
  );
  assert.throws(
    () => new NodeSqliteDatabase({ path: missing }),
    (error) => {
      assert.ok(error instanceof DatabaseError);
      assert.equal(error.code, "io-failure");
      assert.equal(error.operation, "open");
      assert.equal(error.message.includes(missing), false);
      assert.ok(error.cause instanceof Error);
      return true;
    },
  );
});
