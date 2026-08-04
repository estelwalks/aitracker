import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  clearRegenerableCache,
  directorySize,
  isControlledAITrackerDirectory,
  pruneExpiredCacheFiles,
} from "./prune.server.ts";

async function controlledRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  await writeFile(join(root, ".trusttools-data-root"), "trusttools-v1\n");
  return root;
}

test("directorySize sums files recursively and ignores symlinks", async () => {
  const root = await controlledRoot("trusttools-prune-size-");
  await mkdir(join(root, "cache"), { recursive: true });
  await mkdir(join(root, "trash"), { recursive: true });
  await writeFile(join(root, "a.json"), "x".repeat(10));
  await writeFile(join(root, "cache", "index.json"), "y".repeat(20));
  await writeFile(join(root, "trash", "t.json"), "z".repeat(5));

  assert.deepEqual(await directorySize(root), {
    bytes: 10 + 20 + 5 + 14,
    fileCount: 4,
  });
});

test("retention only removes expired files from a marked AITracker cache", async () => {
  const root = await controlledRoot("trusttools-prune-retention-");
  const cache = join(root, "cache");
  await mkdir(cache, { recursive: true });
  const oldCache = join(cache, "old-index.json");
  const freshCache = join(cache, "fresh-index.json");
  const config = join(root, "usage-adapters.json");
  await writeFile(oldCache, "old");
  await writeFile(freshCache, "fresh");
  await writeFile(config, "must remain");
  const now = new Date("2026-08-04T12:00:00.000Z");
  await utimes(
    oldCache,
    new Date(now.getTime() - 31 * 86_400_000),
    new Date(now.getTime() - 31 * 86_400_000),
  );

  const cleanup = await pruneExpiredCacheFiles(30, now, root);
  assert.deepEqual(cleanup, {
    removedFiles: 1,
    removedBytes: 3,
    retainedFiles: 1,
    retentionDays: 30,
    skipped: false,
  });
  await assert.rejects(readFile(oldCache, "utf8"));
  assert.equal(await readFile(freshCache, "utf8"), "fresh");
  assert.equal(await readFile(config, "utf8"), "must remain");
});

test("permanent retention does not delete regenerable cache", async () => {
  const root = await controlledRoot("trusttools-prune-forever-");
  const cacheFile = join(root, "cache", "index.json");
  await mkdir(join(root, "cache"), { recursive: true });
  await writeFile(cacheFile, "cache");

  const cleanup = await pruneExpiredCacheFiles(0, new Date(), root);
  assert.equal(cleanup.removedFiles, 0);
  assert.equal(cleanup.skipped, false);
  assert.equal(await readFile(cacheFile, "utf8"), "cache");
});

test("cache clear returns actual file and byte statistics without touching config", async () => {
  const root = await controlledRoot("trusttools-prune-clear-");
  await mkdir(join(root, "cache", "nested"), { recursive: true });
  await writeFile(join(root, "cache", "index.json"), "1234");
  await writeFile(join(root, "cache", "nested", "market.json"), "123456");
  const config = join(root, "usage-adapters.json");
  await writeFile(config, "keep");

  const cleanup = await clearRegenerableCache(root);
  assert.equal(cleanup.removedFiles, 2);
  assert.equal(cleanup.removedBytes, 10);
  assert.equal(await readFile(config, "utf8"), "keep");
});

test("refuses an unmarked external directory even when it contains a cache folder", async () => {
  const externalRoot = await mkdtemp(join(tmpdir(), "external-ai-tool-log-"));
  const externalLog = join(externalRoot, "cache", "session.jsonl");
  await mkdir(join(externalRoot, "cache"), { recursive: true });
  await writeFile(externalLog, "external tool log");

  assert.equal(await isControlledAITrackerDirectory(externalRoot), false);
  const cleanup = await clearRegenerableCache(externalRoot);
  assert.equal(cleanup.skipped, true);
  assert.match(cleanup.reason ?? "", /未经 AITracker 验证/);
  assert.equal(await readFile(externalLog, "utf8"), "external tool log");
});
