import assert from "node:assert/strict";
import test from "node:test";

import { createProjectorCache } from "./projector-cache.ts";

test("cache returns the same value for the same revision+params", () => {
  const cache = createProjectorCache<string>({ maxEntries: 4 });
  cache.set("r1", { period: "30d" }, "first");
  assert.equal(cache.get("r1", { period: "30d" }), "first");
  assert.equal(cache.get("r1", { period: "7d" }), undefined);
  assert.equal(cache.get("r2", { period: "30d" }), undefined);
});

test("params are normalized regardless of key order", () => {
  const cache = createProjectorCache<string>();
  cache.set("r1", { period: "30d", tool: "all" }, "value");
  assert.equal(cache.get("r1", { tool: "all", period: "30d" }), "value");
});

test("revision change invalidates old projections", () => {
  const cache = createProjectorCache<string>();
  cache.set("r1", {}, "old");
  cache.set("r2", {}, "new");
  assert.equal(cache.get("r1", {}), "old");
  assert.equal(cache.get("r2", {}), "new");
});

test("LRU eviction drops the oldest entry beyond maxEntries", () => {
  const cache = createProjectorCache<string>({ maxEntries: 2 });
  cache.set("r1", { page: "a" }, "a");
  cache.set("r1", { page: "b" }, "b");
  cache.set("r1", { page: "c" }, "c");
  // "a" was evicted; "b" and "c" remain.
  assert.equal(cache.get("r1", { page: "a" }), undefined);
  assert.equal(cache.get("r1", { page: "b" }), "b");
  assert.equal(cache.get("r1", { page: "c" }), "c");
  assert.equal(cache.size, 2);
});

test("clear drops everything", () => {
  const cache = createProjectorCache<string>();
  cache.set("r1", {}, "v");
  cache.clear();
  assert.equal(cache.get("r1", {}), undefined);
  assert.equal(cache.size, 0);
});
