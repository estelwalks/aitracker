import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDatabaseRuntime } from "./database-runtime.server.ts";
import { DatabaseError } from "../platform/database/contracts.ts";
import { LATEST_MIGRATION_VERSION } from "../platform/database/migrations/index.ts";

const clock = { now: () => new Date("2026-08-19T00:00:00.000Z") };
const codec = {
  async encrypt() {
    return {
      ciphertext: new Uint8Array(16),
      encryptionKind: "safe-storage" as const,
    };
  },
  async decrypt() {
    return "secret";
  },
};

test("fresh startup exposes SQLite-only adapters", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-sqlite-runtime-"));
  const runtime = await createDatabaseRuntime({
    dataRoot: root,
    clock,
    secretCodec: codec,
  });
  t.after(async () => {
    runtime.close();
    await rm(root, { recursive: true, force: true });
  });
  assert.equal(runtime.status.state, "active");
  assert.equal(runtime.status.schemaVersion, LATEST_MIGRATION_VERSION);
  assert.equal((await runtime.features.runs.list()).length, 0);
  assert.equal((await runtime.features.preferences.read()).schemaVersion, 2);
});

test("capability failure rejects startup instead of returning another store", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-sqlite-runtime-fail-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(
    createDatabaseRuntime({
      dataRoot: root,
      clock,
      secretCodec: codec,
      versionsProvider: {
        getVersions() {
          return {
            nodeVersion: "24.18.1",
            electronVersion: "43.4.1",
            chromeVersion: "150.0.0.0",
            sqliteVersion: "3.40.0",
          };
        },
      },
    }),
    (error) => error instanceof DatabaseError,
  );
});
