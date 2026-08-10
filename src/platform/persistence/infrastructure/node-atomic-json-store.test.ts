import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { APP_ID } from "../../../lib/app-config";

import { NodeAtomicJsonStore } from "./node-atomic-json-store.ts";
import { NodeFileLock, mapNodeError } from "./node-file-lock.ts";
import { createNodeFileSystem } from "./node-file-system.ts";

const schema = {
  currentVersion: 2,
  migrations: [
    {
      fromVersion: 1,
      toVersion: 2,
      migrate(value: unknown) {
        return { value: (value as { legacyValue: number }).legacyValue };
      },
    },
  ],
  parse(value: unknown) {
    if (
      typeof value !== "object" ||
      value === null ||
      typeof (value as { value?: unknown }).value !== "number"
    ) {
      throw new Error("invalid test value");
    }
    return { value: (value as { value: number }).value };
  },
};

async function withTempDirectory<T>(
  run: (directory: string) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), `${APP_ID}-persistence-`));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("migrates a versioned document atomically and survives a fresh store read", async () => {
  await withTempDirectory(async (directory) => {
    const filePath = join(directory, "state.json");
    await writeFile(
      filePath,
      JSON.stringify({ schemaVersion: 1, data: { legacyValue: 7 } }),
    );
    const store = new NodeAtomicJsonStore({
      filePath,
      defaultValue: { value: 0 },
      schema,
    });

    assert.deepEqual(await store.read(), {
      value: { value: 7 },
      schemaVersion: 2,
      source: "migrated",
    });
    assert.deepEqual(
      await new NodeAtomicJsonStore({
        filePath,
        defaultValue: { value: 0 },
        schema,
      }).read(),
      { value: { value: 7 }, schemaVersion: 2, source: "stored" },
    );
    assert.match(await readFile(filePath, "utf8"), /"schemaVersion":2/);
  });
});

test("backs up corrupt JSON and returns the configured default without reading a half document", async () => {
  await withTempDirectory(async (directory) => {
    const filePath = join(directory, "state.json");
    await writeFile(filePath, "{not-json", "utf8");
    const store = new NodeAtomicJsonStore({
      filePath,
      defaultValue: { value: 0 },
      schema,
      clock: { now: () => new Date("2026-08-06T12:00:00.000Z") },
    });

    assert.deepEqual(await store.read(), {
      value: { value: 0 },
      schemaVersion: 2,
      source: "recovered-corrupt",
      corruptBackupCreated: true,
    });
    const files = await readdir(directory);
    assert.equal(files.includes("state.json"), false);
    assert.equal(
      files.filter((file) => file.startsWith("state.json.corrupt.")).length,
      1,
    );

    await store.write({ value: 3 });
    assert.deepEqual(await store.read(), {
      value: { value: 3 },
      schemaVersion: 2,
      source: "stored",
    });
  });
});

test("keeps the previous complete document when the atomic replace is busy", async () => {
  await withTempDirectory(async (directory) => {
    const filePath = join(directory, "state.json");
    const stableStore = new NodeAtomicJsonStore({
      filePath,
      defaultValue: { value: 0 },
      schema,
    });
    await stableStore.write({ value: 1 });
    const actualFileSystem = createNodeFileSystem();
    const failingStore = new NodeAtomicJsonStore({
      filePath,
      defaultValue: { value: 0 },
      schema,
      fileSystem: {
        ...actualFileSystem,
        async rename() {
          throw Object.assign(new Error("busy"), { code: "EBUSY" });
        },
      },
    });

    await assert.rejects(failingStore.write({ value: 2 }), {
      name: "PersistenceError",
      code: "target-busy",
    });
    assert.deepEqual(await stableStore.read(), {
      value: { value: 1 },
      schemaVersion: 2,
      source: "stored",
    });
  });
});

test("uses a cross-process lock and reports conflicts without removing the owner lock", async () => {
  await withTempDirectory(async (directory) => {
    const filePath = join(directory, "state.json");
    const heldLock = new NodeFileLock(`${filePath}.lock`);
    const lease = await heldLock.acquire();
    const store = new NodeAtomicJsonStore({
      filePath,
      defaultValue: { value: 0 },
      schema,
    });

    await assert.rejects(store.write({ value: 9 }), (error: unknown) => {
      assert.equal((error as { name: string }).name, "PersistenceError");
      assert.equal(
        (error as { code: string; retryable: boolean }).code,
        "lock-conflict",
      );
      assert.equal(
        (error as { code: string; retryable: boolean }).retryable,
        true,
      );
      return true;
    });
    await lease.release();
    await store.write({ value: 9 });
    assert.equal((await store.read()).value.value, 9);
  });
});

test("classifies Windows replacement EPERM as busy while preserving access-denied elsewhere", () => {
  const error = Object.assign(new Error("EPERM"), { code: "EPERM" });
  assert.equal(mapNodeError(error, "write", "win32").code, "target-busy");
  assert.equal(mapNodeError(error, "write", "darwin").code, "access-denied");
});
