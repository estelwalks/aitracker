import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { RuntimeVersionsProvider } from "./capability-probe.server.ts";
import { DatabaseHost } from "./database-host.server.ts";
import { runMigrations } from "./migration-runner.server.ts";
import { LATEST_MIGRATION_VERSION } from "./migrations/index.ts";
import {
  assertUpdateChannelSettings,
  createSqliteUpdateChannelSettingsRepository,
  UPDATE_PROXY_SETTING_ID,
} from "./update-channel-settings-repository.server.ts";

/**
 * Migration 0005 repository: the update-channel proxy is the second deliberate
 * storage carve-out (after `tool_data_roots`). `app_preferences` rejects URL
 * values, so a user-typed `http://` endpoint — the exact input the Settings
 * dialog asks for — must round-trip here instead of failing as "invalid".
 */

interface TestScope {
  after(fn: () => void): void;
}

function versionsProvider(): RuntimeVersionsProvider {
  return {
    getVersions: () => ({ nodeVersion: "24.19.0", sqliteVersion: "99.0.0" }),
  };
}

function openHost(scope: TestScope): DatabaseHost {
  const directory = mkdtempSync(join(tmpdir(), "aitracker-db-update-proxy-"));
  const host = DatabaseHost.open({
    path: join(directory, "platform.db"),
    versionsProvider: versionsProvider(),
  });
  scope.after(() => host.close());
  scope.after(() => {
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch {
      // best effort
    }
  });
  const result = runMigrations({ database: host, appVersion: "test" });
  assert.equal(result.currentVersion, LATEST_MIGRATION_VERSION);
  return host;
}

test("update_channel_settings round-trips an enabled http proxy", async (t) => {
  const host = openHost(t);
  const repository = createSqliteUpdateChannelSettingsRepository(host);

  // Regression: the local Clash-style endpoint the Settings dialog accepts.
  await repository.write({
    proxyUrl: "http://127.0.0.1:7897",
    proxyEnabled: true,
  });

  assert.deepEqual(
    { ...(await repository.read()), updatedAtMs: 0 },
    {
      proxyUrl: "http://127.0.0.1:7897",
      proxyEnabled: true,
      updatedAtMs: 0,
    },
  );
});

test("update_channel_settings accepts every documented scheme", async (t) => {
  const host = openHost(t);
  const repository = createSqliteUpdateChannelSettingsRepository(host);

  for (const proxyUrl of [
    "http://proxy.example.com:8080",
    "https://proxy.example.com:8443",
    "socks4://127.0.0.1:1080",
    "socks5://127.0.0.1:7897",
  ]) {
    await repository.write({ proxyUrl, proxyEnabled: true });
    assert.equal((await repository.read())?.proxyUrl, proxyUrl);
  }
});

test("update_channel_settings keeps a disabled address for later use", async (t) => {
  const host = openHost(t);
  const repository = createSqliteUpdateChannelSettingsRepository(host);

  await repository.write({
    proxyUrl: "http://127.0.0.1:7897",
    proxyEnabled: true,
  });
  await repository.write({
    proxyUrl: "http://127.0.0.1:7897",
    proxyEnabled: false,
  });
  assert.deepEqual(
    { ...(await repository.read()), updatedAtMs: 0 },
    {
      proxyUrl: "http://127.0.0.1:7897",
      proxyEnabled: false,
      updatedAtMs: 0,
    },
  );

  await repository.write({ proxyUrl: null, proxyEnabled: false });
  assert.deepEqual(
    { ...(await repository.read()), updatedAtMs: 0 },
    { proxyUrl: null, proxyEnabled: false, updatedAtMs: 0 },
  );
});

test("update_channel_settings clear() drops the row", async (t) => {
  const host = openHost(t);
  const repository = createSqliteUpdateChannelSettingsRepository(host);

  await repository.write({
    proxyUrl: "http://127.0.0.1:7897",
    proxyEnabled: true,
  });
  await repository.clear();
  assert.equal(await repository.read(), undefined);
});

test("update proxy validation rejects non-endpoint shapes", () => {
  for (const proxyUrl of [
    "ftp://proxy.example.com:21",
    "file:///etc/hosts",
    "HTTP://127.0.0.1:7897",
    "http://user:secret@proxy.example.com:8080",
    "http://127.0.0.1:7897/path",
    "http://127.0.0.1:7897?x=1",
    "http://127.0.0.1:7897#frag",
    "http://127.0.0.1:7897 ",
    "http://",
    "http://127.0.0.1:7897\\",
    "",
  ]) {
    assert.throws(
      () => assertUpdateChannelSettings({ proxyUrl, proxyEnabled: true }),
      TypeError,
      proxyUrl,
    );
  }
  assert.throws(
    () => assertUpdateChannelSettings({ proxyUrl: null, proxyEnabled: true }),
    TypeError,
    "enabled without an address",
  );
  assert.throws(
    () =>
      assertUpdateChannelSettings({
        proxyUrl: "http://127.0.0.1:7897",
        proxyEnabled: "yes" as unknown as boolean,
      }),
    TypeError,
    "non-boolean enabled flag",
  );
});

test("the SQLite CHECK refuses an endpoint-shaped bypass", (t) => {
  const host = openHost(t);
  const insert = (settingId: string, proxyUrl: unknown) =>
    host
      .prepare(
        "INSERT INTO update_channel_settings (setting_id, proxy_url, proxy_enabled, updated_at_ms) VALUES (?, ?, 1, 0)",
      )
      .run(settingId, proxyUrl as never);

  // Raw SQL is refused for the same shapes the repository refuses, so a future
  // writer cannot smuggle a full URL (or a second setting id) past the guard.
  for (const proxyUrl of [
    "ftp://proxy.example.com:21",
    "http://user:secret@proxy.example.com:8080",
    "http://127.0.0.1:7897/path",
    "http://127.0.0.1:7897?x=1",
    "http://127.0.0.1:7897#frag",
    "http://127.0.0.1:7897 ",
    "http://",
  ]) {
    assert.throws(() => insert(UPDATE_PROXY_SETTING_ID, proxyUrl), proxyUrl);
  }
  assert.throws(() => insert("other-setting", "http://127.0.0.1:7897"));
  assert.doesNotThrow(() =>
    insert(UPDATE_PROXY_SETTING_ID, "http://127.0.0.1:7897"),
  );
});
