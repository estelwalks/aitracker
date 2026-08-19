import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { RuntimeVersionsProvider } from "./capability-probe.server.ts";
import { DatabaseError } from "./contracts.ts";
import type { SqliteBindValue } from "./contracts.ts";
import { DatabaseHost } from "./database-host.server.ts";
import { runMigrations } from "./migration-runner.server.ts";

/**
 * T-02-05: every CHECK, FK, UNIQUE and partial-unique constraint of the 11
 * first-wave tables is enforced by the engine, not by application code. The
 * bed is the real `DatabaseHost` (so `foreign_keys=ON` is already asserted)
 * plus the real 0001 migration.
 */

/** Enough of node:test's TestContext for the shared test bed. */
interface TestScope {
  after(fn: () => void): void;
}

const APP_VERSION = "3.0.0-test";

function versionsProvider(): RuntimeVersionsProvider {
  return {
    getVersions: () => ({ nodeVersion: "24.19.0", sqliteVersion: "99.0.0" }),
  };
}

function rmTempDir(directory: string): void {
  try {
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  } catch {
    // Best effort; Windows may hold a handle briefly after close.
  }
}

/** Opens a migrated, file-backed database in a fresh temp directory. */
function openMigratedHost(scope: TestScope): DatabaseHost {
  const directory = mkdtempSync(join(tmpdir(), "tt-db-constraints-"));
  const host = DatabaseHost.open({
    path: join(directory, "platform.db"),
    versionsProvider: versionsProvider(),
  });
  scope.after(() => host.close());
  scope.after(() => rmTempDir(directory));
  const result = runMigrations({ database: host, appVersion: APP_VERSION });
  assert.equal(result.currentVersion, 1);
  return host;
}

function run(
  host: DatabaseHost,
  sql: string,
  ...parameters: SqliteBindValue[]
): void {
  host.prepare(sql).run(...parameters);
}

/** Asserts the statement is refused by the engine with `constraint-violation`. */
function expectRejected(
  host: DatabaseHost,
  what: string,
  sql: string,
  ...parameters: SqliteBindValue[]
): void {
  assert.throws(
    () => run(host, sql, ...parameters),
    (error: unknown) =>
      error instanceof DatabaseError && error.code === "constraint-violation",
    `${what} must be rejected`,
  );
}

function count(host: DatabaseHost, table: string): number {
  const row = host.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get();
  assert.ok(row !== undefined);
  return Number(row.n);
}

const INSERT_SECRET =
  "INSERT INTO secure_secrets (secret_id, purpose, ciphertext, encryption_kind, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?)";

const INSERT_PROFILE =
  "INSERT INTO model_profiles (profile_id, name, mode, protocol, endpoint, model, secret_id, is_active, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

const INSERT_EXECUTION =
  "INSERT INTO ai_executions (request_id, capability, profile_id, prompt_version_id, prompt_version, status, used_fallback, input_tokens, output_tokens, cost_confidence, started_at_ms, finished_at_ms, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

const INSERT_CACHE =
  "INSERT INTO insight_enhancement_cache (cache_key, surface_id, scope_hash, evidence_hash, locale, profile_id, prompt_version_id, prompt_version, model_label, ai_request_id, generated_at_ms, expires_at_ms, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

const INSERT_RUN =
  "INSERT INTO data_migration_runs (run_id, source_kind, source_path_hash, source_schema_version, status, started_at_ms, finished_at_ms, rows_read, rows_written, rows_skipped, error_code, source_fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

const INSERT_DAILY_USAGE =
  "INSERT INTO ai_daily_usage (date_key, capability, profile_key, calls, input_tokens, output_tokens, cost_microusd, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";

const INSERT_LEDGER =
  "INSERT INTO schema_migrations (version, name, checksum, app_version, applied_at_ms, duration_ms) VALUES (?, ?, ?, ?, ?, ?)";

const CIPHERTEXT = new Uint8Array([1, 2, 3, 4]);

function seedSecret(host: DatabaseHost, secretId = "secret-1"): string {
  run(
    host,
    INSERT_SECRET,
    secretId,
    "model-api-key",
    CIPHERTEXT,
    "dpapi",
    1_700_000_000_000,
    1_700_000_000_000,
  );
  return secretId;
}

function seedProfile(
  host: DatabaseHost,
  profileId = "profile-1",
  isActive = 0,
  secretId: string | null = null,
): string {
  run(
    host,
    INSERT_PROFILE,
    profileId,
    "Primary",
    "official",
    "openai",
    null,
    "gpt-test",
    secretId,
    isActive,
    1_700_000_000_000,
    1_700_000_000_000,
  );
  return profileId;
}

function seedCache(
  host: DatabaseHost,
  cacheKey: string,
  profileId: string | null,
): void {
  run(
    host,
    INSERT_CACHE,
    cacheKey,
    "dashboard.today",
    "scope-hash",
    "evidence-hash",
    "zh-CN",
    profileId,
    "prompt-insight",
    3,
    "Test Model",
    null,
    1_700_000_000_000,
    1_700_000_100_000,
    "ready",
  );
}

test("rejects a second active model profile through the partial unique index", (t) => {
  const host = openMigratedHost(t);
  seedProfile(host, "profile-active", 1);
  // Any number of inactive profiles is fine…
  seedProfile(host, "profile-idle-1", 0);
  seedProfile(host, "profile-idle-2", 0);
  // …but never a second active one.
  expectRejected(
    host,
    "a second active profile",
    INSERT_PROFILE,
    "profile-active-2",
    "Secondary",
    "custom",
    "anthropic",
    null,
    "claude-test",
    null,
    1,
    1,
    1,
  );
  expectRejected(
    host,
    "activating a second profile by update",
    "UPDATE model_profiles SET is_active = 1 WHERE profile_id = ?",
    "profile-idle-1",
  );
  assert.equal(count(host, "model_profiles"), 3);
});

test("rejects out-of-range boolean and non-integer values in STRICT columns", (t) => {
  const host = openMigratedHost(t);
  expectRejected(
    host,
    "is_active = 2",
    INSERT_PROFILE,
    "profile-bad-bool",
    "Bad",
    "official",
    "openai",
    null,
    "m",
    null,
    2,
    1,
    1,
  );
  expectRejected(
    host,
    "a TEXT value in an INTEGER column",
    "INSERT INTO runtime_flags (flag_key, value_json, updated_at_ms) VALUES (?, ?, ?)",
    "flag",
    "{}",
    "not-an-integer",
  );
  expectRejected(
    host,
    "a negative updated_at_ms",
    "INSERT INTO runtime_flags (flag_key, value_json, updated_at_ms) VALUES (?, ?, ?)",
    "flag",
    "{}",
    -1,
  );
});

test("rejects every illegal enum value in the first-wave tables", (t) => {
  const host = openMigratedHost(t);
  const profileId = seedProfile(host);

  expectRejected(
    host,
    "secure_secrets.purpose",
    INSERT_SECRET,
    "secret-bad-purpose",
    "session-cookie",
    CIPHERTEXT,
    "dpapi",
    1,
    1,
  );
  expectRejected(
    host,
    "secure_secrets.encryption_kind",
    INSERT_SECRET,
    "secret-bad-kind",
    "model-api-key",
    CIPHERTEXT,
    "rot13",
    1,
    1,
  );
  expectRejected(
    host,
    "model_profiles.mode",
    INSERT_PROFILE,
    "profile-bad-mode",
    "Bad",
    "hybrid",
    "openai",
    null,
    "m",
    null,
    0,
    1,
    1,
  );
  expectRejected(
    host,
    "model_profiles.protocol",
    INSERT_PROFILE,
    "profile-bad-protocol",
    "Bad",
    "official",
    "grpc",
    null,
    "m",
    null,
    0,
    1,
    1,
  );
  expectRejected(
    host,
    "ai_executions.capability",
    INSERT_EXECUTION,
    "req-bad-capability",
    "chat",
    profileId,
    "prompt-1",
    1,
    "completed",
    0,
    1,
    1,
    "exact",
    1,
    2,
    1,
  );
  expectRejected(
    host,
    "ai_executions.status",
    INSERT_EXECUTION,
    "req-bad-status",
    "report",
    profileId,
    "prompt-1",
    1,
    "half-done",
    0,
    1,
    1,
    "exact",
    1,
    2,
    1,
  );
  expectRejected(
    host,
    "ai_executions.cost_confidence",
    INSERT_EXECUTION,
    "req-bad-confidence",
    "report",
    profileId,
    "prompt-1",
    1,
    "completed",
    0,
    1,
    1,
    "probably",
    1,
    2,
    1,
  );
  expectRejected(
    host,
    "ai_executions.used_fallback",
    INSERT_EXECUTION,
    "req-bad-fallback",
    "report",
    profileId,
    "prompt-1",
    1,
    "completed",
    7,
    1,
    1,
    "exact",
    1,
    2,
    1,
  );
  expectRejected(
    host,
    "ai_executions negative token counts",
    INSERT_EXECUTION,
    "req-bad-tokens",
    "report",
    profileId,
    "prompt-1",
    1,
    "completed",
    0,
    -1,
    1,
    "exact",
    1,
    2,
    1,
  );
  expectRejected(
    host,
    "data_migration_runs.source_kind",
    INSERT_RUN,
    "run-bad-kind",
    "yaml-blob",
    "path-hash",
    1,
    "running",
    1,
    null,
    0,
    0,
    0,
    null,
    "fingerprint",
  );
  expectRejected(
    host,
    "data_migration_runs.status",
    INSERT_RUN,
    "run-bad-status",
    "atomic-json",
    "path-hash",
    1,
    "pending",
    1,
    null,
    0,
    0,
    0,
    null,
    "fingerprint",
  );
  expectRejected(
    host,
    "app_preferences.value_type",
    "INSERT INTO app_preferences (preference_key, value_json, value_type, updated_at_ms) VALUES (?, ?, ?, ?)",
    "ui.locale",
    '"zh-CN"',
    "bigint",
    1,
  );
  expectRejected(
    host,
    "insight_preferences.mode",
    "INSERT INTO insight_preferences (scope_key, mode, profile_id, updated_at_ms) VALUES (?, ?, ?, ?)",
    "global",
    "enhanced",
    profileId,
    1,
  );
  expectRejected(
    host,
    "insight_enhancement_cache.status",
    INSERT_CACHE,
    "cache-bad-status",
    "dashboard.today",
    "scope",
    "evidence",
    "zh-CN",
    profileId,
    "prompt-1",
    1,
    "Model",
    null,
    1,
    2,
    "stale",
  );
});

test("rejects non-JSON payloads in every *_json column", (t) => {
  const host = openMigratedHost(t);
  expectRejected(
    host,
    "app_preferences.value_json",
    "INSERT INTO app_preferences (preference_key, value_json, value_type, updated_at_ms) VALUES (?, ?, ?, ?)",
    "widget.layout",
    "{not json",
    "object",
    1,
  );
  expectRejected(
    host,
    "runtime_flags.value_json",
    "INSERT INTO runtime_flags (flag_key, value_json, updated_at_ms) VALUES (?, ?, ?)",
    "insight.killSwitch",
    "undefined",
    1,
  );
  // Valid JSON of every allowed value_type is accepted.
  for (const [key, json, type] of [
    ["a.string", '"zh-CN"', "string"],
    ["a.number", "42", "number"],
    ["a.boolean", "true", "boolean"],
    ["a.object", '{"k":1}', "object"],
    ["a.array", "[1,2]", "array"],
    ["a.null", "null", "null"],
  ] as const) {
    run(
      host,
      "INSERT INTO app_preferences (preference_key, value_json, value_type, updated_at_ms) VALUES (?, ?, ?, ?)",
      key,
      json,
      type,
      1,
    );
  }
  assert.equal(count(host, "app_preferences"), 6);
});

test("rejects a duplicate ai_daily_usage composite primary key", (t) => {
  const host = openMigratedHost(t);
  run(
    host,
    INSERT_DAILY_USAGE,
    "2026-08-18",
    "page-insight",
    "profile-1",
    1,
    10,
    20,
    30,
    1,
  );
  // Same day + capability, different profile key: allowed.
  run(
    host,
    INSERT_DAILY_USAGE,
    "2026-08-18",
    "page-insight",
    "offline",
    1,
    0,
    0,
    0,
    1,
  );
  expectRejected(
    host,
    "a duplicate (date_key, capability, profile_key)",
    INSERT_DAILY_USAGE,
    "2026-08-18",
    "page-insight",
    "profile-1",
    2,
    0,
    0,
    0,
    2,
  );
  expectRejected(
    host,
    "a NULL primary-key column",
    INSERT_DAILY_USAGE,
    "2026-08-18",
    "page-insight",
    null,
    1,
    0,
    0,
    0,
    1,
  );
  assert.equal(count(host, "ai_daily_usage"), 2);
});

test("rejects a seven-column insight_enhancement_cache UNIQUE conflict", (t) => {
  const host = openMigratedHost(t);
  const profileId = seedProfile(host);
  seedCache(host, "cache-1", profileId);

  // A different cache_key with identical business identity is refused.
  expectRejected(
    host,
    "the seven-column cache identity",
    INSERT_CACHE,
    "cache-2",
    "dashboard.today",
    "scope-hash",
    "evidence-hash",
    "zh-CN",
    profileId,
    "prompt-insight",
    3,
    "Other Model",
    null,
    1_700_000_000_001,
    1_700_000_100_001,
    "ready",
  );
  // Changing any single component of the identity is allowed.
  run(
    host,
    INSERT_CACHE,
    "cache-3",
    "dashboard.today",
    "scope-hash",
    "evidence-hash",
    "en-US",
    profileId,
    "prompt-insight",
    3,
    "Other Model",
    null,
    1_700_000_000_002,
    1_700_000_100_002,
    "ready",
  );
  run(
    host,
    INSERT_CACHE,
    "cache-4",
    "dashboard.today",
    "scope-hash",
    "evidence-hash",
    "zh-CN",
    profileId,
    "prompt-insight",
    4,
    "Other Model",
    null,
    1_700_000_000_003,
    1_700_000_100_003,
    "ready",
  );
  assert.equal(count(host, "insight_enhancement_cache"), 3);
});

test("rejects a data_migration_runs idempotency-index conflict", (t) => {
  const host = openMigratedHost(t);
  run(
    host,
    INSERT_RUN,
    "run-1",
    "atomic-json",
    "path-hash-1",
    2,
    "succeeded",
    1,
    2,
    10,
    10,
    0,
    null,
    "fingerprint-1",
  );
  expectRejected(
    host,
    "a repeated (source_kind, source_path_hash, source_fingerprint)",
    INSERT_RUN,
    "run-2",
    "atomic-json",
    "path-hash-1",
    2,
    "running",
    3,
    null,
    0,
    0,
    0,
    null,
    "fingerprint-1",
  );
  // A new fingerprint for the same file is a new, legal run.
  run(
    host,
    INSERT_RUN,
    "run-3",
    "atomic-json",
    "path-hash-1",
    2,
    "running",
    3,
    null,
    0,
    0,
    0,
    null,
    "fingerprint-2",
  );
  assert.equal(count(host, "data_migration_runs"), 2);
});

test("rejects negative schema_migrations timings", (t) => {
  const host = openMigratedHost(t);
  expectRejected(
    host,
    "duration_ms < 0",
    INSERT_LEDGER,
    2,
    "0002_negative_duration",
    "checksum",
    APP_VERSION,
    1_700_000_000_000,
    -1,
  );
  expectRejected(
    host,
    "applied_at_ms < 0",
    INSERT_LEDGER,
    3,
    "0003_negative_applied",
    "checksum",
    APP_VERSION,
    -1,
    0,
  );
  expectRejected(
    host,
    "a duplicate migration name",
    INSERT_LEDGER,
    4,
    "0001_platform",
    "checksum",
    APP_VERSION,
    1,
    0,
  );
  assert.equal(count(host, "schema_migrations"), 1);
});

test("enforces foreign keys on every first-wave reference", (t) => {
  const host = openMigratedHost(t);
  const profileId = seedProfile(host);

  expectRejected(
    host,
    "model_profiles.secret_id → missing secure_secrets row",
    INSERT_PROFILE,
    "profile-dangling-secret",
    "Dangling",
    "custom",
    "openai",
    null,
    "m",
    "no-such-secret",
    0,
    1,
    1,
  );
  expectRejected(
    host,
    "insight_enhancement_cache.profile_id → missing model_profiles row",
    INSERT_CACHE,
    "cache-dangling",
    "dashboard.today",
    "scope",
    "evidence",
    "zh-CN",
    "no-such-profile",
    "prompt-1",
    1,
    "Model",
    null,
    1,
    2,
    "ready",
  );
  expectRejected(
    host,
    "ai_executions.profile_id → missing model_profiles row",
    INSERT_EXECUTION,
    "req-dangling",
    "report",
    "no-such-profile",
    "prompt-1",
    1,
    "completed",
    0,
    1,
    1,
    "exact",
    1,
    2,
    1,
  );
  expectRejected(
    host,
    "insight_enhancement_lines.cache_key → missing cache row",
    "INSERT INTO insight_enhancement_lines (cache_key, sequence, candidate_id, analysis, action_id) VALUES (?, ?, ?, ?, ?)",
    "no-such-cache",
    0,
    "candidate-1",
    "分析结论",
    "action-1",
  );
  expectRejected(
    host,
    "insight_preferences.profile_id → missing model_profiles row",
    "INSERT INTO insight_preferences (scope_key, mode, profile_id, updated_at_ms) VALUES (?, ?, ?, ?)",
    "surface:dashboard.today",
    "enhanced-auto",
    "no-such-profile",
    1,
  );
  assert.equal(count(host, "insight_enhancement_cache"), 0);
  assert.equal(count(host, "ai_executions"), 0);
  // The same rows are accepted once they point at an existing profile.
  seedCache(host, "cache-ok", profileId);
  assert.equal(count(host, "insight_enhancement_cache"), 1);
});

test("cascades cache deletes to lines and profile deletes to cache", (t) => {
  const host = openMigratedHost(t);
  const secretId = seedSecret(host);
  const profileId = seedProfile(host, "profile-1", 1, secretId);
  seedCache(host, "cache-1", profileId);
  run(
    host,
    "INSERT INTO insight_enhancement_lines (cache_key, sequence, candidate_id, analysis, action_id) VALUES (?, ?, ?, ?, ?)",
    "cache-1",
    0,
    "candidate-1",
    "分析结论",
    "action-1",
  );
  expectRejected(
    host,
    "a duplicate (cache_key, sequence)",
    "INSERT INTO insight_enhancement_lines (cache_key, sequence, candidate_id, analysis, action_id) VALUES (?, ?, ?, ?, ?)",
    "cache-1",
    0,
    "candidate-2",
    "另一条分析",
    "action-2",
  );

  // Deleting the profile cascades to the cache, which cascades to its lines.
  run(host, "DELETE FROM model_profiles WHERE profile_id = ?", profileId);
  assert.equal(count(host, "insight_enhancement_cache"), 0);
  assert.equal(count(host, "insight_enhancement_lines"), 0);
  // The secret survives; only the profile referenced it.
  assert.equal(count(host, "secure_secrets"), 1);
});

test("applies the documented defaults", (t) => {
  const host = openMigratedHost(t);
  run(
    host,
    "INSERT INTO insight_preferences (scope_key, updated_at_ms) VALUES (?, ?)",
    "global",
    1,
  );
  const preference = host
    .prepare(
      "SELECT mode, daily_call_limit FROM insight_preferences WHERE scope_key = ?",
    )
    .get("global");
  assert.ok(preference !== undefined);
  assert.equal(preference.mode, "rules");
  assert.equal(preference.daily_call_limit, null);

  run(
    host,
    "INSERT INTO ai_daily_usage (date_key, capability, profile_key, updated_at_ms) VALUES (?, ?, ?, ?)",
    "2026-08-18",
    "page-insight",
    "offline",
    1,
  );
  const usage = host
    .prepare(
      "SELECT calls, input_tokens, output_tokens, cost_microusd FROM ai_daily_usage",
    )
    .get();
  assert.ok(usage !== undefined);
  assert.equal(Number(usage.calls), 0);
  assert.equal(Number(usage.input_tokens), 0);
  assert.equal(Number(usage.output_tokens), 0);
  assert.equal(Number(usage.cost_microusd), 0);

  run(
    host,
    "INSERT INTO model_profiles (profile_id, name, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?)",
    "profile-default-active",
    "Default",
    1,
    1,
  );
  const profile = host
    .prepare("SELECT is_active FROM model_profiles WHERE profile_id = ?")
    .get("profile-default-active");
  assert.ok(profile !== undefined);
  assert.equal(Number(profile.is_active), 0);
});
