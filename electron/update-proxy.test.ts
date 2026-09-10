import assert from "node:assert/strict";
import test from "node:test";

import { normalizeUpdateProxy, updateProxyConfig } from "./update-proxy.ts";

test("an empty value clears the proxy and follows the system", () => {
  assert.equal(normalizeUpdateProxy(""), "");
  assert.equal(normalizeUpdateProxy("   "), "");
  assert.deepEqual(updateProxyConfig(""), { mode: "system" });
});

test("a bare host:port gains the http scheme", () => {
  assert.equal(normalizeUpdateProxy("127.0.0.1:7890"), "http://127.0.0.1:7890");
  assert.deepEqual(updateProxyConfig("http://127.0.0.1:7890"), {
    mode: "fixed_servers",
    proxyRules: "http://127.0.0.1:7890",
    proxyBypassRules: "<local>",
  });
});

test("http, https and socks schemes are preserved", () => {
  assert.equal(
    normalizeUpdateProxy("http://proxy.example.com:8080"),
    "http://proxy.example.com:8080",
  );
  assert.equal(
    normalizeUpdateProxy("https://proxy.example.com:8443"),
    "https://proxy.example.com:8443",
  );
  assert.equal(
    normalizeUpdateProxy("socks5://127.0.0.1:1080"),
    "socks5://127.0.0.1:1080",
  );
  assert.equal(
    normalizeUpdateProxy("socks4://127.0.0.1:1080"),
    "socks4://127.0.0.1:1080",
  );
});

test("unusable proxy values are rejected", () => {
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
    assert.throws(() => normalizeUpdateProxy(value), TypeError, value);
  }
});
