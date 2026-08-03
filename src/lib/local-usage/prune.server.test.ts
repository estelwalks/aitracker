import assert from "node:assert";
import { test } from "node:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { directorySize } from "./prune.server.ts";

test("directorySize sums files recursively and counts them", async () => {
  const root = await mkdtemp(join(tmpdir(), "trusttools-prune-"));
  await mkdir(join(root, "cache"), { recursive: true });
  await mkdir(join(root, "trash"), { recursive: true });
  await writeFile(join(root, "a.json"), "x".repeat(10));
  await writeFile(join(root, "cache", "local-usage-index-v10.json"), "y".repeat(20));
  await writeFile(join(root, "trash", "t.json"), "z".repeat(5));

  const result = await directorySize(root);
  assert.equal(result.bytes, 35);
  assert.equal(result.fileCount, 3);
});

test("directorySize returns zeros for a missing directory", async () => {
  const result = await directorySize(join(tmpdir(), "does-not-exist-xyz-123"));
  assert.equal(result.bytes, 0);
  assert.equal(result.fileCount, 0);
});

test("directorySize ignores nested directories in the count but sums their files", async () => {
  const root = await mkdtemp(join(tmpdir(), "trusttools-prune-nested-"));
  await mkdir(join(root, "sub"), { recursive: true });
  await writeFile(join(root, "top.txt"), "ab"); // 2
  await writeFile(join(root, "sub", "leaf.txt"), "abcd"); // 4
  const result = await directorySize(root);
  assert.equal(result.bytes, 6);
  assert.equal(result.fileCount, 2); // directories are not counted as files
});
