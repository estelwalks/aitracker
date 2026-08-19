import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ENV, STORAGE_KEY_PREFIX, TEST_TMP_PREFIX } from "../app-config.ts";
import { DEFAULT_SETTINGS } from "./model.ts";
import { readCurrentRetentionDays } from "./retention-policy.server.ts";

test("reads retentionDays from the Electron preferences source of truth", async () => {
  const root = await mkdtemp(join(tmpdir(), `${TEST_TMP_PREFIX}retention-`));
  const path = join(root, "prefs.json");
  const previous = process.env[ENV.PREFS_PATH];
  try {
    await writeFile(
      path,
      JSON.stringify({
        [`${STORAGE_KEY_PREFIX}settings.v1`]: JSON.stringify({
          retentionDays: 30,
        }),
      }),
    );
    process.env[ENV.PREFS_PATH] = path;
    assert.equal(await readCurrentRetentionDays(), 30);
  } finally {
    if (previous == null) delete process.env[ENV.PREFS_PATH];
    else process.env[ENV.PREFS_PATH] = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("falls back safely when desktop preferences are unavailable", async () => {
  const previous = process.env[ENV.PREFS_PATH];
  try {
    delete process.env[ENV.PREFS_PATH];
    assert.equal(
      await readCurrentRetentionDays(),
      DEFAULT_SETTINGS.retentionDays,
    );
  } finally {
    if (previous != null) process.env[ENV.PREFS_PATH] = previous;
  }
});
