import assert from "node:assert/strict";
import test from "node:test";

import {
  addChunkReloadNonce,
  claimChunkReload,
  isChunkLoadError,
} from "./chunk-recovery.ts";

test("isChunkLoadError recognizes lazy route failures but not loader errors", () => {
  assert.equal(
    isChunkLoadError(
      new TypeError("Failed to fetch dynamically imported module"),
    ),
    true,
  );
  assert.equal(
    isChunkLoadError(new Error("snapshot database is locked")),
    false,
  );
});

test("claimChunkReload allows one reload per route", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  assert.equal(claimChunkReload(storage, "/tracker"), true);
  assert.equal(claimChunkReload(storage, "/tracker"), false);
  assert.equal(claimChunkReload(storage, "/settings"), true);
});

test("addChunkReloadNonce preserves the route and existing query", () => {
  assert.equal(
    addChunkReloadNonce("https://example.test/tracker?locale=zh-CN", 123),
    "https://example.test/tracker?locale=zh-CN&_chunk_reload=123",
  );
});
