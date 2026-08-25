import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DatabaseHost } from "./database-host.server.ts";
import { runMigrations } from "./migration-runner.server.ts";
import {
  applyDatabaseRetention,
  clearCollectedDatabaseData,
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

test("clearCollectedDatabaseData removes collector projections but preserves user data", (t) => {
  const host = openMigratedHost(t);
  const now = 2_000_000_000_000;
  host
    .prepare(
      `INSERT INTO snapshot_generations (
        snapshot_id, domain, schema_version, revision, generated_at_ms,
        status, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run("usage-snapshot", "usage", 1, "r1", now, "fresh", now);
  host
    .prepare(
      "INSERT INTO snapshot_heads (domain, snapshot_id, updated_at_ms) VALUES (?, ?, ?)",
    )
    .run("usage", "usage-snapshot", now);
  host
    .prepare(
      "INSERT INTO project_classifications (ref_hash, kind, label, classified_at_ms, revision) VALUES (?, ?, ?, ?, ?)",
    )
    .run("ref", "workspace", "project", now, 1);
  const insertSearch = host.prepare(
    `INSERT INTO search_documents
      (document_id, type, source_ref, title, tags_json, text_summary, freshness, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertSearch.run(
    "session:1",
    "session",
    "session:1",
    "Session",
    "[]",
    "Session summary",
    "fresh",
    now,
  );
  insertSearch.run(
    "report:1",
    "report",
    "report:1",
    "Report",
    "[]",
    "Report summary",
    "fresh",
    now,
  );
  host
    .prepare(
      `INSERT INTO monitoring_state
        (singleton_id, running, started_at_ms, heartbeat_at_ms, pending_count, security_summary_json, updated_at_ms)
       VALUES (1, 1, ?, ?, 1, ?, ?)`,
    )
    .run(now, now, JSON.stringify({ assessed: 1 }), now);
  host
    .prepare(
      `INSERT INTO monitoring_collectors
        (collector_id, state, pending, last_started_at_ms)
       VALUES (?, ?, ?, ?)`,
    )
    .run("usage", "running", 1, now);

  const summary = clearCollectedDatabaseData(host);
  assert.deepEqual(summary, {
    snapshotGenerationsDeleted: 1,
    projectClassificationsDeleted: 1,
    searchDocumentsDeleted: 1,
  });
  assert.equal(count(host, "snapshot_generations"), 0);
  assert.equal(count(host, "snapshot_heads"), 0);
  assert.equal(count(host, "project_classifications"), 0);
  assert.equal(count(host, "search_documents"), 1);
  assert.equal(count(host, "monitoring_collectors"), 0);
  const monitoring = host
    .prepare(
      "SELECT running, started_at_ms, heartbeat_at_ms, pending_count, security_summary_json FROM monitoring_state WHERE singleton_id = 1",
    )
    .get();
  assert.equal(Number(monitoring?.running), 0);
  assert.equal(monitoring?.started_at_ms, null);
  assert.equal(monitoring?.heartbeat_at_ms, null);
  assert.equal(Number(monitoring?.pending_count), 0);
  assert.equal(monitoring?.security_summary_json, null);
});
