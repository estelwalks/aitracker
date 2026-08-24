import assert from "node:assert/strict";
import test from "node:test";

import {
  addChunkReloadNonce,
  claimChunkReload,
  completeChunkRecovery,
  isChunkLoadError,
  recoverFromVitePreloadError,
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
    removeItem: (key: string) => values.delete(key),
  };
  assert.equal(claimChunkReload(storage, "/tracker"), true);
  assert.equal(claimChunkReload(storage, "/tracker"), false);
  assert.equal(claimChunkReload(storage, "/settings"), true);

  assert.equal(
    completeChunkRecovery(
      storage,
      "https://example.test/tracker?_chunk_reload=123",
    ),
    "https://example.test/tracker",
  );
  assert.equal(claimChunkReload(storage, "/tracker"), true);
});

test("addChunkReloadNonce preserves the route and existing query", () => {
  assert.equal(
    addChunkReloadNonce("https://example.test/tracker?locale=zh-CN", 123),
    "https://example.test/tracker?locale=zh-CN&_chunk_reload=123",
  );
});

test("Vite preload failure reloads once with a cache-busting URL", () => {
  const values = new Map<string, string>();
  const reloaded: string[] = [];
  let prevented = false;
  const browser = {
    sessionStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
    location: {
      href: "https://example.test/tracker?locale=zh-CN",
      pathname: "/tracker",
      replace: (href: string) => reloaded.push(href),
    },
  };
  const event = { preventDefault: () => (prevented = true) };

  recoverFromVitePreloadError(browser, event);
  recoverFromVitePreloadError(browser, event);

  assert.equal(prevented, true);
  assert.equal(reloaded.length, 1);
  assert.match(
    reloaded[0] ?? "",
    /^https:\/\/example\.test\/tracker\?locale=zh-CN&_chunk_reload=\d+$/u,
  );
});
