import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_AUTO_UPDATE_ENABLED,
  normalizeUpdateProxyInput,
  parseAutoUpdateEnabled,
} from "./update-preferences.ts";

test("automatic updates are enabled by default", () => {
  assert.equal(DEFAULT_AUTO_UPDATE_ENABLED, true);
  assert.equal(parseAutoUpdateEnabled(undefined), true);
  assert.equal(parseAutoUpdateEnabled("not-json"), true);
});

test("only an explicit false disables automatic updates", () => {
  assert.equal(parseAutoUpdateEnabled(false), false);
  assert.equal(parseAutoUpdateEnabled("false"), false);
  assert.equal(parseAutoUpdateEnabled(JSON.stringify(false)), false);
  assert.equal(parseAutoUpdateEnabled(true), true);
  assert.equal(parseAutoUpdateEnabled("0"), true);
});

// The renderer mirror exists so the Settings dialog can tell a bad address
// apart from a failed save. These cases MUST match
// `electron/update-proxy.test.ts`, which owns the authoritative normalizer.
test("a local http proxy endpoint is a valid update proxy", () => {
  assert.equal(
    normalizeUpdateProxyInput("http://127.0.0.1:7897"),
    "http://127.0.0.1:7897",
  );
  assert.equal(
    normalizeUpdateProxyInput("127.0.0.1:7897"),
    "http://127.0.0.1:7897",
  );
  assert.equal(
    normalizeUpdateProxyInput("  http://127.0.0.1:7897  "),
    "http://127.0.0.1:7897",
  );
  assert.equal(normalizeUpdateProxyInput(""), "");
});

test("every documented update proxy scheme is preserved", () => {
  for (const value of [
    "http://proxy.example.com:8080",
    "https://proxy.example.com:8443",
    "socks4://127.0.0.1:1080",
    "socks5://127.0.0.1:7897",
  ]) {
    assert.equal(normalizeUpdateProxyInput(value), value);
  }
});

test("unusable update proxy values are rejected in the renderer too", () => {
  for (const value of [
    "ftp://proxy.example.com:21",
    "file:///etc/hosts",
    "http://user:secret@proxy.example.com:8080",
    "http://127.0.0.1:7890/path",
    "http://127.0.0.1:7890?query=1",
    "http://127.0.0.1:7890#fragment",
    "not a proxy at all \u0000",
    "http://",
  ]) {
    assert.throws(() => normalizeUpdateProxyInput(value), TypeError, value);
  }
});
