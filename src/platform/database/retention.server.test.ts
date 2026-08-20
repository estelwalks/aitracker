import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DatabaseHost } from "./database-host.server.ts";
import { runMigrations } from "./migration-runner.server.ts";
import {
  applyDatabaseRetention,
  clearRegenerableDatabaseCaches,
} from "./retention.server.ts";

function openMigratedHost(t: { after(fn: () => void): void }): DatabaseHost {
  const directory = mkdtempSync(join(tmpdir(), "tt-db-retention-"));
  const host = DatabaseHost.open({
    path: join(directory, "platform.db"),
    versionsProvider: {
      getVersions: () => ({ nodeVersion: "24.19.0", sqliteVersion: "99.0.0" }),
    },
  });
  runMigrations({ database: host, appVersion: "test" });
  t.after(() => host.close());
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return host;
}

function count(host: DatabaseHost, table: string): number {
  return Number(host.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n);
}

test("applyDatabaseRetention removes expired rows and keeps fresh ones", (t) => {
  const host = openMigratedHost(t);
  const now = 2_000_000_000_000;

  const insertHttp = (namespace: string, key: string, expiresAtMs: number) =>
    host
      .prepare(
        `INSERT INTO http_cache_entries (namespace, cache_key, payload_json, etag, fetched_at_ms, expires_at_ms, status_code, payload_bytes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(namespace, key, "{}", null, now - 1000, expiresAtMs, 200, 2);
  insertHttp("market", "expired", now - 1);
  insertHttp("market", "fresh", now + 1000);

  const insertInsight = (
    cacheKey: string,
    surfaceId: string,
    expiresAtMs: number,
    status: string,
    generatedAtMs: number,
  ) =>
    host
      .prepare(
        `INSERT INTO insight_enhancement_cache (cache_key, surface_id, scope_hash, evidence_hash, locale, generated_at_ms, expires_at_ms, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        cacheKey,
        surfaceId,
        "scope",
        "evidence",
        "zh-CN",
        generatedAtMs,
        expiresAtMs,
        status,
      );
  insertInsight("ck-expired", "surface-1", now - 1, "ready", now - 2000);
  insertInsight(
    "ck-invalidated-old",
    "surface-2",
    now + 1000,
    "invalidated",
    now - 2 * 86_400_000,
  );
  insertInsight("ck-fresh", "surface-3", now + 1000, "ready", now);

  const summary = applyDatabaseRetention(host, now);
  assert.equal(summary.httpCacheDeleted, 1);
  assert.equal(summary.insightCacheDeleted, 2);
  assert.equal(summary.snapshotGenerationsDeleted, 0);

  assert.equal(count(host, "http_cache_entries"), 1);
  assert.equal(count(host, "insight_enhancement_cache"), 1);
  assert.ok(
    host
      .prepare("SELECT 1 FROM insight_enhancement_cache WHERE cache_key = ?")
      .get("ck-fresh"),
  );
});

test("clearRegenerableDatabaseCaches removes every regenerable row", (t) => {
  const host = openMigratedHost(t);
  const now = 2_000_000_000_000;
  host
    .prepare(
      `INSERT INTO http_cache_entries (namespace, cache_key, payload_json, fetched_at_ms, expires_at_ms, payload_bytes)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run("market", "k", "{}", now, now + 1000, 2);
  host
    .prepare(
      `INSERT INTO insight_enhancement_cache (cache_key, surface_id, scope_hash, evidence_hash, locale, generated_at_ms, expires_at_ms, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "ck",
      "surface",
      "scope",
      "evidence",
      "zh-CN",
      now,
      now + 1000,
      "ready",
    );

  const summary = clearRegenerableDatabaseCaches(host);
  assert.equal(summary.httpCacheDeleted, 1);
  assert.equal(summary.insightCacheDeleted, 1);
  assert.equal(count(host, "http_cache_entries"), 0);
  assert.equal(count(host, "insight_enhancement_cache"), 0);
});
