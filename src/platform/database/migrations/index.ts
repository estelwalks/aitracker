/**
 * Migration definitions for the TrustTools local storage database
 * (Story S-02, T-02-02).
 *
 * Browser-safe on purpose: this module contains nothing but the immutable DDL
 * text and its ordered metadata — no `node:` imports, no filesystem access.
 *
 * WHY THE SQL IS INLINED: the Nitro `node-server` build emits a single-file
 * bundle, so nothing may depend on reading `migrations/*.sql` from disk at
 * runtime. The string below is therefore the copy that actually executes, and
 * `./0001_platform.sql` is the reviewable source of the same text.
 *
 * DUAL-SOURCE CONTRACT: `PLATFORM_MIGRATION_0001_SQL` and
 * `./0001_platform.sql` must stay byte-for-byte identical (after line-ending
 * normalization). `migration-runner.test.ts` asserts both the text and the
 * SHA-256 checksum, so editing one side alone fails the suite.
 */

/** One immutable, forward-only migration. */
export interface MigrationDefinition {
  /** Strictly increasing, positive integer version. */
  readonly version: number;
  /** Stable unique name, e.g. `0001_platform`. */
  readonly name: string;
  /** Complete DDL/DML text executed inside a single transaction. */
  readonly sql: string;
}

/**
 * Verbatim copy of `./0001_platform.sql` — first-wave 11 STRICT tables
 * (architecture §5.1 / §5.2 / §5.10).
 */
export const PLATFORM_MIGRATION_0001_SQL = `-- TrustTools local storage database — migration 0001 "platform".
--
-- Authoritative source text for the first-wave 11 tables (architecture
-- §5.1 / §5.2 / §5.10). Every table is STRICT; creation order follows the
-- foreign-key dependency order and schema_migrations comes first because the
-- migration runner writes its ledger row inside the same transaction.
--
-- DUAL-SOURCE CONTRACT: this file and the inline PLATFORM_MIGRATION_0001_SQL
-- string in ./index.ts must stay byte-for-byte identical (line-ending
-- normalized). The Nitro/node-server build is a single-file bundle and cannot
-- read .sql files at runtime, so the inline copy is what actually executes and
-- this file is what humans review and what migration-runner.test.ts diffs.
-- Never edit one side alone.
--
-- Forward-only: no down migration. Non-first-wave tables (snapshots, usage,
-- sessions, reports, knowledge, security, search, insight_feedback, …) are
-- deliberately NOT created here.

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  checksum TEXT NOT NULL,
  app_version TEXT NOT NULL,
  applied_at_ms INTEGER NOT NULL CHECK (applied_at_ms >= 0),
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0)
) STRICT;

CREATE TABLE data_migration_runs (
  run_id TEXT PRIMARY KEY,
  source_kind TEXT NOT NULL CHECK (
    source_kind IN ('atomic-json', 'electron-prefs', 'security-json', 'cache-json')
  ),
  source_path_hash TEXT NOT NULL,
  source_schema_version INTEGER,
  status TEXT CHECK (
    status IS NULL OR status IN ('running', 'succeeded', 'failed', 'skipped')
  ),
  started_at_ms INTEGER CHECK (started_at_ms IS NULL OR started_at_ms >= 0),
  finished_at_ms INTEGER CHECK (finished_at_ms IS NULL OR finished_at_ms >= 0),
  rows_read INTEGER NOT NULL DEFAULT 0,
  rows_written INTEGER NOT NULL DEFAULT 0,
  rows_skipped INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  source_fingerprint TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX idx_data_migration_runs_idempotency
  ON data_migration_runs (source_kind, source_path_hash, source_fingerprint);

CREATE TABLE app_preferences (
  preference_key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  value_type TEXT CHECK (
    value_type IS NULL
    OR value_type IN ('string', 'number', 'boolean', 'object', 'array', 'null')
  ),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
) STRICT;

CREATE TABLE runtime_flags (
  flag_key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
) STRICT;

CREATE TABLE secure_secrets (
  secret_id TEXT PRIMARY KEY,
  purpose TEXT CHECK (purpose IS NULL OR purpose IN ('model-api-key')),
  ciphertext BLOB NOT NULL,
  encryption_kind TEXT CHECK (
    encryption_kind IS NULL
    OR encryption_kind IN ('dpapi', 'keychain', 'safe-storage')
  ),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
) STRICT;

CREATE TABLE model_profiles (
  profile_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mode TEXT CHECK (mode IS NULL OR mode IN ('official', 'custom')),
  protocol TEXT CHECK (protocol IS NULL OR protocol IN ('openai', 'anthropic')),
  endpoint TEXT,
  model TEXT,
  secret_id TEXT REFERENCES secure_secrets (secret_id) ON DELETE SET NULL,
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
) STRICT;

-- At most one active profile, enforced by the engine rather than by app code.
CREATE UNIQUE INDEX idx_model_profiles_single_active
  ON model_profiles (is_active) WHERE is_active = 1;

CREATE TABLE ai_executions (
  request_id TEXT PRIMARY KEY,
  capability TEXT NOT NULL CHECK (
    capability IN ('distillation', 'report', 'security', 'page-insight')
  ),
  profile_id TEXT REFERENCES model_profiles (profile_id) ON DELETE SET NULL,
  provider_id TEXT,
  model_id TEXT,
  prompt_version_id TEXT NOT NULL,
  prompt_version INTEGER NOT NULL,
  input_fingerprint TEXT,
  status TEXT CHECK (
    status IS NULL
    OR status IN (
      'completed',
      'offline',
      'fallback',
      'budget',
      'timeout',
      'cancelled',
      'failed'
    )
  ),
  used_fallback INTEGER CHECK (used_fallback IS NULL OR used_fallback IN (0, 1)),
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  cost_microusd INTEGER,
  cost_confidence TEXT CHECK (
    cost_confidence IS NULL
    OR cost_confidence IN ('exact', 'estimated', 'unknown')
  ),
  error_code TEXT,
  started_at_ms INTEGER CHECK (started_at_ms IS NULL OR started_at_ms >= 0),
  finished_at_ms INTEGER CHECK (finished_at_ms IS NULL OR finished_at_ms >= 0),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0)
) STRICT;

CREATE INDEX idx_ai_executions_capability_started
  ON ai_executions (capability, started_at_ms DESC);

CREATE INDEX idx_ai_executions_profile_started
  ON ai_executions (profile_id, started_at_ms DESC);

CREATE INDEX idx_ai_executions_status_started
  ON ai_executions (status, started_at_ms DESC);

CREATE TABLE ai_daily_usage (
  date_key TEXT NOT NULL,
  capability TEXT NOT NULL,
  profile_key TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_microusd INTEGER NOT NULL DEFAULT 0,
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0),
  PRIMARY KEY (date_key, capability, profile_key)
) STRICT;

CREATE TABLE insight_preferences (
  scope_key TEXT PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'rules' CHECK (
    mode IN ('rules', 'enhanced-manual', 'enhanced-auto')
  ),
  profile_id TEXT REFERENCES model_profiles (profile_id) ON DELETE SET NULL,
  consent_version TEXT,
  consented_at_ms INTEGER CHECK (consented_at_ms IS NULL OR consented_at_ms >= 0),
  daily_call_limit INTEGER,
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
) STRICT;

CREATE TABLE insight_enhancement_cache (
  cache_key TEXT PRIMARY KEY,
  surface_id TEXT NOT NULL,
  scope_hash TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  locale TEXT NOT NULL,
  profile_id TEXT REFERENCES model_profiles (profile_id) ON DELETE CASCADE,
  prompt_version_id TEXT,
  prompt_version INTEGER,
  model_label TEXT,
  ai_request_id TEXT REFERENCES ai_executions (request_id) ON DELETE SET NULL,
  generated_at_ms INTEGER NOT NULL CHECK (generated_at_ms >= 0),
  expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms >= 0),
  status TEXT CHECK (status IS NULL OR status IN ('ready', 'invalidated')),
  UNIQUE (
    surface_id,
    scope_hash,
    evidence_hash,
    locale,
    profile_id,
    prompt_version_id,
    prompt_version
  )
) STRICT;

CREATE INDEX idx_insight_enhancement_cache_surface_expires
  ON insight_enhancement_cache (surface_id, expires_at_ms);

CREATE TABLE insight_enhancement_lines (
  cache_key TEXT NOT NULL
    REFERENCES insight_enhancement_cache (cache_key) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  candidate_id TEXT,
  analysis TEXT,
  action_id TEXT,
  PRIMARY KEY (cache_key, sequence)
) STRICT;
`;

/** Ordered, immutable migration list consumed by `runMigrations`. */
export const MIGRATIONS: readonly MigrationDefinition[] = [
  {
    version: 1,
    name: "0001_platform",
    sql: PLATFORM_MIGRATION_0001_SQL,
  },
];

/** Highest version this build knows how to migrate to. */
export const LATEST_MIGRATION_VERSION = 1;
