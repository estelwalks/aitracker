// Seed a throwaway AITracker home for the offline-page e2e scenarios
// (tests/e2e/offline-market-rates.spec.ts) so the pages under test exercise
// their network paths with a deterministic local state:
//
//   node scripts/e2e/seed-offline-home.mjs <targetHomeDir> [--mode warm|cold]
//
// Default mode: `warm` — seeds a fresh SQLite database (byte-schema-identical
// to a fresh install, mirroring scripts/e2e/seed-stale-home.mjs) plus
// http_cache_entries rows that make BOTH online integrations behave as if a
// recent successful fetch had happened while the machine was online:
//   * Security Market list (namespace skill-market, key "1:10::stars:"),
//   * exchange rates (namespace exchange-rates, key "usd").
// `cold` seeds only the empty database: every network-backed page must then
// degrade without any local cache.
//
// The cache rows carry real timestamps (fresh at seed time) because the e2e
// dev server runs against the live clock; the market cache is considered
// fresh for 30 minutes and the exchange-rate cache for 24 hours, so an
// immediately-following test run reads them as "cache"/"cache".
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { INITIAL_SCHEMA_SQL } from "../../src/platform/database/migrations/index.ts";

const APP_VERSION = "1.0.0"; // keep in sync with src/lib/app-config.ts
const USAGE =
  "usage: node scripts/e2e/seed-offline-home.mjs <targetHomeDir> [--mode warm|cold]";

function parseArgs(argv) {
  let mode = "warm";
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--mode") {
      const value = argv[i + 1];
      if (value !== "warm" && value !== "cold") {
        throw new Error(`--mode requires 'warm' or 'cold' (got: ${value})`);
      }
      mode = value;
      i += 1;
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`unknown option: ${arg}`);
    positionals.push(arg);
  }
  if (positionals.length !== 1) throw new Error(USAGE);
  return { targetDir: positionals[0], mode };
}

function checksum(sql) {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

/** Same schema bootstrapping as seed-stale-home.mjs (deterministic ledger). */
function runMigrations(database) {
  database.exec(INITIAL_SCHEMA_SQL);
  database
    .prepare(
      `INSERT INTO schema_migrations
         (version, name, checksum, app_version, applied_at_ms, duration_ms)
       VALUES (1, '0001_initial_schema', ?, ?, ?, 0)`,
    )
    .run(checksum(INITIAL_SCHEMA_SQL), APP_VERSION, 0);
  database.exec("PRAGMA user_version = 1");
}

function sha256Hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * A non-null-but-empty usage/skills snapshot keeps the snapshot coordinator
 * off the machine scan path (mirrors seed-stale-home.mjs).
 */
function seedStaleSnapshot(database, domain, nowMs) {
  const generatedAtMs = nowMs - 7 * 24 * 60 * 60 * 1000; // 7 days stale
  const snapshotId = `seed-${domain}-stale`;
  database
    .prepare(
      `INSERT INTO snapshot_generations
         (snapshot_id, domain, schema_version, revision, generated_at_ms,
          source_fingerprint, status, last_attempt_at_ms, last_success_at_ms,
          duration_ms, scanned_items, reused_items, created_at_ms)
       VALUES (?, ?, 1, ?, ?, NULL, 'fresh', ?, ?, NULL, NULL, NULL, ?)`,
    )
    .run(
      snapshotId,
      domain,
      `seed-${domain}-stale-v1`,
      generatedAtMs,
      generatedAtMs,
      generatedAtMs,
      generatedAtMs,
    );
  database
    .prepare(
      `INSERT INTO snapshot_heads (domain, snapshot_id, updated_at_ms)
       VALUES (?, ?, ?)`,
    )
    .run(domain, snapshotId, generatedAtMs);
}

/**
 * HTTP-cache row for the Security Market list that fetchMarketSkills() would
 * have written after a successful network fetch. Payload mirrors the wire
 * shape (incl. repoPath) so the cache read + projector behave identically.
 */
function seedMarketCache(database, nowMs) {
  const fetchedAt = new Date(nowMs - 60_000).toISOString();
  const payload = {
    skills: [
      {
        id: 9001,
        name: "Offline Demo Skill",
        slug: "offline-demo-skill",
        description: "Seeded local cache entry for the offline e2e scenario",
        shortDescription: "离线缓存示例 Skill（e2e）",
        repoOwner: "example-owner",
        repoName: "example-repo",
        repoPath: "skills/offline-demo/SKILL.md",
        securityScore: 95,
        securityLevel: "low",
        stars: 128,
        tags: ["demo"],
        updatedAt: new Date(nowMs - 86_400_000).toISOString(),
        size: null,
        version: null,
        rating: null,
      },
    ],
    pagination: { page: 1, limit: 10, total: 1, pages: 1 },
    source: "network",
    fetchedAt,
    warning: null,
    stats: { totalSkills: 1, installedCount: 0 },
  };
  const payloadJson = JSON.stringify(payload);
  const key = sha256Hex("1:10::stars:"); // marketCacheKey(1, 10, "", "stars", "")
  database
    .prepare(
      `INSERT INTO http_cache_entries
         (namespace, cache_key, payload_json, etag, fetched_at_ms,
          expires_at_ms, status_code, payload_bytes)
       VALUES (?, ?, ?, NULL, ?, ?, 200, ?)`,
    )
    .run(
      "skill-market",
      key,
      payloadJson,
      nowMs - 60_000,
      nowMs - 60_000 + 30 * 60 * 1_000, // MARKET_QUERY_CACHE_TTL_MS
      Buffer.byteLength(payloadJson, "utf8"),
    );
}

/** HTTP-cache row for exchange rates (namespace exchange-rates, key usd). */
function seedExchangeRatesCache(database, nowMs) {
  const payload = {
    fetchedAt: new Date(nowMs - 60_000).toISOString(),
    date: new Date(nowMs).toISOString().slice(0, 10),
    rates: { CNY: 7.1, JPY: 148, KRW: 1350 },
  };
  const payloadJson = JSON.stringify(payload);
  const key = sha256Hex("usd");
  database
    .prepare(
      `INSERT INTO http_cache_entries
         (namespace, cache_key, payload_json, etag, fetched_at_ms,
          expires_at_ms, status_code, payload_bytes)
       VALUES (?, ?, ?, NULL, ?, ?, 200, ?)`,
    )
    .run(
      "exchange-rates",
      key,
      payloadJson,
      nowMs - 60_000,
      Number.MAX_SAFE_INTEGER, // mirror repository.put() semantics
      Buffer.byteLength(payloadJson, "utf8"),
    );
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`seed-offline-home: ${error.message}\n`);
    process.exitCode = 1;
    return;
  }

  const dataDir = join(args.targetDir, ".aitracker", "data");
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "aitracker.v1.db");
  const nowMs = Date.now();

  const database = new DatabaseSync(dbPath);
  try {
    runMigrations(database);
    seedStaleSnapshot(database, "usage", nowMs);
    seedStaleSnapshot(database, "skills", nowMs);
    if (args.mode === "warm") {
      seedMarketCache(database, nowMs);
      seedExchangeRatesCache(database, nowMs);
    }
  } finally {
    database.close();
  }

  process.stdout.write(
    `seed-offline-home: seeded ${dbPath} (mode=${args.mode})\n`,
  );
}

main();
