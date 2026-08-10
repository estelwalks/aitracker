import assert from "node:assert/strict";
import test from "node:test";
import { loadOfflineCache, saveOfflineCache } from "./offline-cache.ts";
import type { AtomicJsonStore } from "../../../platform/persistence/contracts.ts";
import { normalizeSkillPackage } from "../domain.ts";
import type { OfflineCacheDocument } from "../contracts.ts";

function store(
  initial: OfflineCacheDocument | undefined,
): AtomicJsonStore<OfflineCacheDocument> & { current?: OfflineCacheDocument } {
  let current = initial;
  return {
    get current() {
      return current;
    },
    async read() {
      if (!current) throw new Error("corrupt");
      return { value: current, source: "stored", schemaVersion: 1 };
    },
    async write(value) {
      current = structuredClone(value);
    },
  };
}

const pkg = normalizeSkillPackage({
  name: "cache-skill",
  version: "1",
  source: "local",
  hash: "sha256-" + "d".repeat(64),
});
const clock = { now: () => new Date("2026-01-02T00:00:00.000Z") };

test("offline cache saves and loads safe metadata, with stale detection", async () => {
  const target = store(undefined);
  await saveOfflineCache(target, [pkg], clock);
  const fresh = await loadOfflineCache(target, clock, 86_400_000);
  assert.equal(fresh.entries.length, 1);
  assert.equal(fresh.stale, false);
  assert.equal("packageRef" in fresh.entries[0], false);
  const stale = await loadOfflineCache(
    target,
    { now: () => new Date("2026-01-04T00:00:00.000Z") },
    86_400_000,
  );
  assert.equal(stale.stale, true);
});

test("corrupt or malformed cache falls back to empty stale cache", async () => {
  const corrupt = store({ schemaVersion: 2 as 1, savedAt: "bad", entries: [] });
  const result = await loadOfflineCache(corrupt, clock);
  assert.deepEqual(result, { entries: [], stale: true });
  const missing = await loadOfflineCache(store(undefined), clock);
  assert.deepEqual(missing, { entries: [], stale: true });
});
