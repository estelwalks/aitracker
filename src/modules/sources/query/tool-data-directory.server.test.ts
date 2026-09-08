import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  expandTildePath,
  writeToolDataDirectory,
} from "./tool-data-directory.server.ts";

/**
 * The data-directory configuration supports hand-entered paths in addition to
 * the native folder dialog — the reliable way to reach hidden directories
 * such as `~/.hermes` on macOS. Leading `~` expands server-side.
 */

test("expandTildePath expands ~ and leaves absolute paths unchanged", () => {
  assert.equal(
    expandTildePath("~/.hermes", "/home/alice"),
    "/home/alice/.hermes",
  );
  assert.equal(
    expandTildePath("~/state.db", "/home/alice"),
    "/home/alice/state.db",
  );
  assert.equal(expandTildePath("~", "/home/alice"), "/home/alice");
  assert.equal(expandTildePath("/data/hermes", "/home/alice"), "/data/hermes");
  assert.equal(expandTildePath("D:/hermes", "/home/alice"), "D:/hermes");
  assert.equal(expandTildePath("", "/home/alice"), "");
});

test("writeToolDataDirectory persists absolute directories and rejects bad input", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-tool-dir-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new Map<string, string>();
  const repository = {
    async set(toolId: string, dir: string) {
      store.set(toolId, dir);
    },
    async delete(toolId: string) {
      return store.delete(toolId);
    },
  };

  const saved = await writeToolDataDirectory(repository, "hermes", root);
  assert.equal(saved.configured, true);
  assert.equal(saved.dataDir, root);
  assert.equal(store.get("hermes"), root);

  const cleared = await writeToolDataDirectory(repository, "hermes", null);
  assert.equal(cleared.configured, false);
  assert.equal(store.has("hermes"), false);

  await assert.rejects(
    () => writeToolDataDirectory(repository, "hermes", join(root, "missing")),
    /not-a-directory/,
  );
  await assert.rejects(
    () => writeToolDataDirectory(repository, "hermes", "relative/path"),
    /absolute directory path/,
  );
});
