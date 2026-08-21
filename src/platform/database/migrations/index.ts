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

import { PLATFORM_MIGRATION_0004_SQL } from "./0004_business_assets.ts";
import { PLATFORM_MIGRATION_0005_SQL } from "./0005_search_wsl.ts";
import { PLATFORM_MIGRATION_0006_SQL } from "./0006_memory_body.ts";
import { PLATFORM_MIGRATION_0007_SQL } from "./0007_model_profile_auth.ts";
import { PLATFORM_MIGRATION_0008_SQL } from "./0008_skill_form.ts";

export { PLATFORM_MIGRATION_0004_SQL } from "./0004_business_assets.ts";
export { PLATFORM_MIGRATION_0005_SQL } from "./0005_search_wsl.ts";
export { PLATFORM_MIGRATION_0006_SQL } from "./0006_memory_body.ts";
export { PLATFORM_MIGRATION_0007_SQL } from "./0007_model_profile_auth.ts";
export { PLATFORM_MIGRATION_0008_SQL } from "./0008_skill_form.ts";

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
 * Verbatim copy of `./0001_platform.sql` — new-project 10 STRICT tables
 * (architecture §5.1 / §5.2 / §5.10).
 */
export const PLATFORM_MIGRATION_0001_SQL = `-- TrustTools local storage database — migration 0001 "platform".
--
-- Authoritative source text for the new-project 10 tables (architecture
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

-- Database identity stamp (architecture §9-6): a file carrying this
-- application_id is a TrustTools platform database. user_version is
-- deliberately NOT stamped here — the migration runner writes and asserts it
-- inside each migration's transaction (PRAGMA user_version = <version>), so
-- 0001 must never contain a competing PRAGMA user_version statement.
PRAGMA application_id = 0x54544442;

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  checksum TEXT NOT NULL,
  app_version TEXT NOT NULL,
  applied_at_ms INTEGER NOT NULL CHECK (applied_at_ms >= 0),
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0)
) STRICT;

-- value_json carries a content "forbidden zone" CHECK (§9-4 / §14.4) so a raw
-- SQL write — not just the repository guard — still refuses drive-letter paths,
-- Bearer tokens and backslashes. GLOB has no portable literal-backslash pattern
-- under the dual-source byte-identity contract, so a backslash is detected with
-- instr(value_json, char(92)) instead of a literal backslash in a GLOB pattern.
CREATE TABLE app_preferences (
  preference_key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL CHECK (
    json_valid(value_json)
    AND value_json NOT GLOB '*[A-Za-z]:/*'
    AND value_json NOT LIKE '%Bearer %'
    AND instr(value_json, char(92)) = 0
  ),
  value_type TEXT NOT NULL CHECK (
    value_type IN ('string', 'number', 'boolean', 'object', 'array', 'null')
  ),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0),
  CHECK (
    (value_type = 'string' AND json_type(value_json) = 'text')
    OR (value_type = 'number' AND json_type(value_json) IN ('integer', 'real'))
    OR (value_type = 'boolean' AND json_type(value_json) IN ('true', 'false'))
    OR (value_type = 'object' AND json_type(value_json) = 'object')
    OR (value_type = 'array' AND json_type(value_json) = 'array')
    OR (value_type = 'null' AND json_type(value_json) = 'null')
  )
) STRICT;

CREATE TABLE runtime_flags (
  flag_key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
) STRICT;

CREATE TABLE secure_secrets (
  secret_id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL DEFAULT 'model-api-key' CHECK (
    purpose IN ('model-api-key')
  ),
  ciphertext BLOB NOT NULL CHECK (length(ciphertext) >= 16),
  encryption_kind TEXT NOT NULL CHECK (
    encryption_kind IN ('dpapi', 'keychain', 'safe-storage')
  ),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
) STRICT;

CREATE TABLE model_profiles (
  profile_id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 64),
  mode TEXT NOT NULL DEFAULT 'custom' CHECK (
    mode IN ('official', 'custom')
  ),
  protocol TEXT NOT NULL CHECK (
    protocol IN ('openai', 'anthropic')
  ),
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
  status TEXT NOT NULL CHECK (
    status IN (
      'completed',
      'offline',
      'fallback',
      'budget',
      'timeout',
      'cancelled',
      'failed'
    )
  ),
  used_fallback INTEGER NOT NULL DEFAULT 0 CHECK (used_fallback IN (0, 1)),
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
  date_key TEXT NOT NULL CHECK (
    date_key GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  capability TEXT NOT NULL CHECK (
    capability IN ('distillation', 'report', 'security', 'page-insight')
  ),
  profile_key TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0 CHECK (calls >= 0),
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cost_microusd INTEGER NOT NULL DEFAULT 0 CHECK (cost_microusd >= 0),
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
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'invalidated'))
) STRICT;

CREATE INDEX idx_insight_enhancement_cache_surface_expires
  ON insight_enhancement_cache (surface_id, expires_at_ms);

-- SQLite's multi-column UNIQUE treats NULLs as distinct, so two rows with the
-- same business identity coexist when profile/prompt are NULL (review P2-2 /
-- EXP 5a). The expression index collapses NULL profile/prompt to sentinels so
-- the cache identity stays unique even without a configured model.
CREATE UNIQUE INDEX idx_insight_enhancement_cache_identity
  ON insight_enhancement_cache (
    surface_id,
    scope_hash,
    evidence_hash,
    locale,
    COALESCE(profile_id, ''),
    COALESCE(prompt_version_id, ''),
    COALESCE(prompt_version, 0)
  );

-- analysis is a rendered fact sentence (§5.10): no digits, no drive-letter
-- colon, no backslash. The char(92) note above applies here too.
CREATE TABLE insight_enhancement_lines (
  cache_key TEXT NOT NULL
    REFERENCES insight_enhancement_cache (cache_key) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  candidate_id TEXT,
  analysis TEXT CHECK (
    analysis IS NULL
    OR (
      analysis NOT GLOB '*[0-9]*'
      AND analysis NOT GLOB '*[A-Za-z]:*'
      AND instr(analysis, char(92)) = 0
    )
  ),
  action_id TEXT,
  PRIMARY KEY (cache_key, sequence)
) STRICT;
`;

/** Verbatim copy of `./0002_low_risk_state.sql` — M2 bounded state. */
export const PLATFORM_MIGRATION_0002_SQL = `-- TrustTools local storage database — migration 0002 "low risk state".
-- M2 moves small, bounded runtime state to normalized STRICT tables. Static
-- task definitions remain code-owned and are deliberately not duplicated.

CREATE TABLE task_preferences (
  task_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  schedule_kind TEXT CHECK (
    schedule_kind IS NULL
    OR schedule_kind IN ('interval', 'daily', 'weekly', 'monthly')
  ),
  interval_minutes INTEGER CHECK (interval_minutes IS NULL OR interval_minutes > 0),
  weekday INTEGER CHECK (weekday IS NULL OR weekday BETWEEN 1 AND 7),
  day_of_month INTEGER CHECK (day_of_month IS NULL OR day_of_month BETWEEN 1 AND 31),
  local_time TEXT CHECK (
    local_time IS NULL
    OR (
      length(local_time) = 5
      AND local_time GLOB '[0-2][0-9]:[0-5][0-9]'
      AND substr(local_time, 1, 2) <= '23'
    )
  ),
  timezone TEXT,
  options_json TEXT CHECK (options_json IS NULL OR json_valid(options_json)),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0),
  CHECK (
    (schedule_kind IS NULL AND interval_minutes IS NULL AND weekday IS NULL AND day_of_month IS NULL AND local_time IS NULL)
    OR (schedule_kind = 'interval' AND interval_minutes IS NOT NULL AND weekday IS NULL AND day_of_month IS NULL AND local_time IS NULL)
    OR (schedule_kind = 'daily' AND interval_minutes IS NULL AND weekday IS NULL AND day_of_month IS NULL AND local_time IS NOT NULL)
    OR (schedule_kind = 'weekly' AND interval_minutes IS NULL AND weekday IS NOT NULL AND day_of_month IS NULL AND local_time IS NOT NULL)
    OR (schedule_kind = 'monthly' AND interval_minutes IS NULL AND weekday IS NULL AND day_of_month IS NOT NULL AND local_time IS NOT NULL)
  )
) STRICT;

CREATE TABLE task_runs (
  run_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'schedule', 'startup-recovery', 'event')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'waiting-approval', 'succeeded', 'failed', 'cancelled', 'skipped', 'abandoned')),
  queued_at_ms INTEGER CHECK (queued_at_ms IS NULL OR queued_at_ms >= 0),
  started_at_ms INTEGER CHECK (started_at_ms IS NULL OR started_at_ms >= 0),
  finished_at_ms INTEGER CHECK (finished_at_ms IS NULL OR finished_at_ms >= 0),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  attempt INTEGER NOT NULL CHECK (attempt BETWEEN 1 AND 100),
  correlation_id TEXT NOT NULL,
  error_code TEXT,
  retryable INTEGER CHECK (retryable IS NULL OR retryable IN (0, 1)),
  input_fingerprint TEXT,
  output_ref TEXT,
  scanned INTEGER CHECK (scanned IS NULL OR scanned >= 0),
  changed INTEGER CHECK (changed IS NULL OR changed >= 0),
  diagnostic_count INTEGER CHECK (diagnostic_count IS NULL OR diagnostic_count >= 0),
  skipped_reason TEXT CHECK (skipped_reason IS NULL OR skipped_reason IN ('already-running', 'queue-full', 'not-stale', 'disabled'))
) STRICT;

CREATE INDEX idx_task_runs_task_started
  ON task_runs (task_id, started_at_ms DESC);
CREATE INDEX idx_task_runs_status_started
  ON task_runs (status, started_at_ms);
CREATE INDEX idx_task_runs_correlation
  ON task_runs (correlation_id);

CREATE TABLE monitoring_state (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  running INTEGER NOT NULL CHECK (running IN (0, 1)),
  started_at_ms INTEGER CHECK (started_at_ms IS NULL OR started_at_ms >= 0),
  heartbeat_at_ms INTEGER CHECK (heartbeat_at_ms IS NULL OR heartbeat_at_ms >= 0),
  pending_count INTEGER NOT NULL CHECK (pending_count >= 0),
  security_summary_json TEXT CHECK (security_summary_json IS NULL OR json_valid(security_summary_json)),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
) STRICT;

CREATE TABLE monitoring_collectors (
  collector_id TEXT PRIMARY KEY CHECK (collector_id IN ('usage', 'skills', 'sessions', 'security', 'exchange', 'installation')),
  state TEXT NOT NULL CHECK (state IN ('idle', 'running', 'healthy', 'degraded', 'failed')),
  pending INTEGER NOT NULL CHECK (pending IN (0, 1)),
  last_started_at_ms INTEGER CHECK (last_started_at_ms IS NULL OR last_started_at_ms >= 0),
  last_succeeded_at_ms INTEGER CHECK (last_succeeded_at_ms IS NULL OR last_succeeded_at_ms >= 0),
  last_failed_at_ms INTEGER CHECK (last_failed_at_ms IS NULL OR last_failed_at_ms >= 0),
  error_code TEXT
) STRICT;

CREATE TABLE http_cache_entries (
  namespace TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  etag TEXT,
  fetched_at_ms INTEGER NOT NULL CHECK (fetched_at_ms >= 0),
  expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms >= 0),
  status_code INTEGER CHECK (status_code IS NULL OR status_code BETWEEN 100 AND 599),
  payload_bytes INTEGER NOT NULL CHECK (payload_bytes >= 0),
  PRIMARY KEY (namespace, cache_key),
  CHECK (expires_at_ms >= fetched_at_ms)
) STRICT;

CREATE INDEX idx_http_cache_namespace_expires
  ON http_cache_entries (namespace, expires_at_ms);
`;

/** Verbatim copy of `./0003_snapshot_read_models.sql` — M3 projections. */
export const PLATFORM_MIGRATION_0003_SQL = `-- TrustTools local storage database — migration 0003 "snapshot read models".
-- Normalized, generation-addressed projections. Refresh writers insert a
-- complete generation and move snapshot_heads only in the same transaction.

CREATE TABLE snapshot_generations (
  snapshot_id TEXT PRIMARY KEY,
  domain TEXT NOT NULL CHECK (domain IN ('usage','sessions','skills','installations','wsl','exchange')),
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  revision TEXT NOT NULL,
  generated_at_ms INTEGER CHECK (generated_at_ms IS NULL OR generated_at_ms >= 0),
  source_fingerprint TEXT,
  status TEXT NOT NULL CHECK (status IN ('empty','fresh','stale','failed')),
  last_attempt_at_ms INTEGER CHECK (last_attempt_at_ms IS NULL OR last_attempt_at_ms >= 0),
  last_success_at_ms INTEGER CHECK (last_success_at_ms IS NULL OR last_success_at_ms >= 0),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  scanned_items INTEGER CHECK (scanned_items IS NULL OR scanned_items >= 0),
  reused_items INTEGER CHECK (reused_items IS NULL OR reused_items >= 0),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  UNIQUE (domain, revision)
) STRICT;
CREATE INDEX idx_snapshot_generations_domain_created ON snapshot_generations (domain, created_at_ms DESC);

CREATE TABLE snapshot_heads (
  domain TEXT PRIMARY KEY CHECK (domain IN ('usage','sessions','skills','installations','wsl','exchange')),
  snapshot_id TEXT NOT NULL REFERENCES snapshot_generations(snapshot_id) ON DELETE RESTRICT,
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
) STRICT;

CREATE TABLE snapshot_warnings (
  snapshot_id TEXT NOT NULL REFERENCES snapshot_generations(snapshot_id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  warning_code TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, sequence)
) STRICT;

CREATE TABLE usage_sources (
  snapshot_id TEXT NOT NULL REFERENCES snapshot_generations(snapshot_id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  available INTEGER NOT NULL CHECK (available IN (0,1)),
  detected INTEGER CHECK (detected IS NULL OR detected IN (0,1)),
  files_considered INTEGER NOT NULL CHECK (files_considered >= 0),
  files_read INTEGER NOT NULL CHECK (files_read >= 0),
  files_reused INTEGER NOT NULL CHECK (files_reused >= 0),
  files_parsed INTEGER NOT NULL CHECK (files_parsed >= 0),
  malformed_lines INTEGER NOT NULL CHECK (malformed_lines >= 0),
  event_count INTEGER NOT NULL CHECK (event_count >= 0),
  PRIMARY KEY (snapshot_id, source_id)
) STRICT;
CREATE TABLE usage_source_diagnostics (
  snapshot_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  code TEXT NOT NULL,
  count INTEGER NOT NULL CHECK (count >= 0),
  message_key TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, source_id, sequence),
  FOREIGN KEY (snapshot_id, source_id) REFERENCES usage_sources(snapshot_id, source_id) ON DELETE CASCADE
) STRICT;
CREATE TABLE usage_events (
  snapshot_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  occurred_at_ms INTEGER NOT NULL CHECK (occurred_at_ms >= 0),
  model_id TEXT NOT NULL,
  project_ref_hash TEXT,
  project_label TEXT,
  session_ref TEXT,
  measurement TEXT NOT NULL DEFAULT 'observed' CHECK (measurement IN ('observed','estimated')),
  input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
  cached_input_tokens INTEGER NOT NULL CHECK (cached_input_tokens >= 0),
  cache_creation_input_tokens INTEGER NOT NULL CHECK (cache_creation_input_tokens >= 0),
  output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
  reasoning_output_tokens INTEGER NOT NULL CHECK (reasoning_output_tokens >= 0),
  total_tokens INTEGER NOT NULL CHECK (total_tokens >= 0),
  has_text_response INTEGER CHECK (has_text_response IS NULL OR has_text_response IN (0,1)),
  is_recent INTEGER NOT NULL DEFAULT 0 CHECK (is_recent IN (0,1)),
  PRIMARY KEY (snapshot_id, event_id),
  FOREIGN KEY (snapshot_id, source_id) REFERENCES usage_sources(snapshot_id, source_id) ON DELETE CASCADE
) STRICT;
CREATE INDEX idx_usage_events_time ON usage_events(snapshot_id, occurred_at_ms DESC);
CREATE INDEX idx_usage_events_source_time ON usage_events(snapshot_id, source_id, occurred_at_ms DESC);
CREATE INDEX idx_usage_events_model ON usage_events(snapshot_id, model_id);
CREATE INDEX idx_usage_events_project ON usage_events(snapshot_id, project_ref_hash);
CREATE INDEX idx_usage_events_session ON usage_events(snapshot_id, session_ref);
CREATE TABLE usage_event_tool_calls (
  snapshot_id TEXT NOT NULL, event_id TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL,
  calls INTEGER NOT NULL CHECK (calls > 0), PRIMARY KEY(snapshot_id,event_id,name,category),
  FOREIGN KEY(snapshot_id,event_id) REFERENCES usage_events(snapshot_id,event_id) ON DELETE CASCADE
) STRICT;
CREATE TABLE usage_event_skill_calls (
  snapshot_id TEXT NOT NULL, event_id TEXT NOT NULL, skill_name TEXT NOT NULL,
  calls INTEGER NOT NULL CHECK (calls > 0), PRIMARY KEY(snapshot_id,event_id,skill_name),
  FOREIGN KEY(snapshot_id,event_id) REFERENCES usage_events(snapshot_id,event_id) ON DELETE CASCADE
) STRICT;
CREATE TABLE usage_event_command_stats (
  snapshot_id TEXT NOT NULL, event_id TEXT NOT NULL, safe_signature TEXT NOT NULL,
  executable_label TEXT NOT NULL, duration_bucket TEXT NOT NULL, output_size_bucket TEXT NOT NULL,
  exit_status TEXT NOT NULL, calls INTEGER NOT NULL CHECK(calls > 0),
  PRIMARY KEY(snapshot_id,event_id,safe_signature),
  FOREIGN KEY(snapshot_id,event_id) REFERENCES usage_events(snapshot_id,event_id) ON DELETE CASCADE
) STRICT;
CREATE TABLE usage_event_output_summaries (
  snapshot_id TEXT NOT NULL, event_id TEXT NOT NULL, characters INTEGER NOT NULL CHECK(characters >= 0),
  lines INTEGER NOT NULL CHECK(lines >= 0), completed INTEGER NOT NULL CHECK(completed IN (0,1)),
  calls INTEGER NOT NULL CHECK(calls >= 0), PRIMARY KEY(snapshot_id,event_id),
  FOREIGN KEY(snapshot_id,event_id) REFERENCES usage_events(snapshot_id,event_id) ON DELETE CASCADE
) STRICT;
CREATE TABLE usage_daily_aggregates (
  snapshot_id TEXT NOT NULL REFERENCES snapshot_generations(snapshot_id) ON DELETE CASCADE,
  date_key TEXT NOT NULL, source_id TEXT NOT NULL, events INTEGER NOT NULL CHECK(events >= 0),
  input_tokens INTEGER NOT NULL CHECK(input_tokens >= 0), cached_input_tokens INTEGER NOT NULL CHECK(cached_input_tokens >= 0),
  cache_creation_input_tokens INTEGER NOT NULL CHECK(cache_creation_input_tokens >= 0), output_tokens INTEGER NOT NULL CHECK(output_tokens >= 0),
  reasoning_output_tokens INTEGER NOT NULL CHECK(reasoning_output_tokens >= 0), total_tokens INTEGER NOT NULL CHECK(total_tokens >= 0),
  PRIMARY KEY(snapshot_id,date_key,source_id)
) STRICT;

CREATE TABLE project_classifications (
  ref_hash TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('workspace','quick-conversation','unknown')),
  label TEXT NOT NULL, fingerprint TEXT, classified_at_ms INTEGER NOT NULL CHECK(classified_at_ms >= 0),
  revision INTEGER NOT NULL CHECK(revision > 0)
) STRICT;
CREATE INDEX idx_project_classifications_kind_time ON project_classifications(kind, classified_at_ms DESC);

CREATE TABLE sessions (
  snapshot_id TEXT NOT NULL REFERENCES snapshot_generations(snapshot_id) ON DELETE CASCADE, source_id TEXT NOT NULL,
  session_id TEXT NOT NULL, title TEXT NOT NULL, project_key TEXT NOT NULL, project_ref_hash TEXT, model_id TEXT,
  started_at_ms INTEGER NOT NULL CHECK(started_at_ms >= 0), ended_at_ms INTEGER NOT NULL CHECK(ended_at_ms >= 0),
  duration_ms INTEGER NOT NULL CHECK(duration_ms >= 0), turns INTEGER NOT NULL CHECK(turns >= 0), edit_turns INTEGER NOT NULL CHECK(edit_turns >= 0),
  retry_turns INTEGER NOT NULL CHECK(retry_turns >= 0), subagent_calls INTEGER NOT NULL CHECK(subagent_calls >= 0),
  input_tokens INTEGER NOT NULL CHECK(input_tokens >= 0), cached_input_tokens INTEGER NOT NULL CHECK(cached_input_tokens >= 0),
  cache_creation_input_tokens INTEGER NOT NULL CHECK(cache_creation_input_tokens >= 0), output_tokens INTEGER NOT NULL CHECK(output_tokens >= 0),
  reasoning_output_tokens INTEGER NOT NULL CHECK(reasoning_output_tokens >= 0), total_tokens INTEGER NOT NULL CHECK(total_tokens >= 0),
  known_microusd INTEGER NOT NULL CHECK(known_microusd >= 0), estimated_microusd INTEGER NOT NULL CHECK(estimated_microusd >= 0),
  cache_savings_microusd INTEGER NOT NULL CHECK(cache_savings_microusd >= 0), priced_events INTEGER NOT NULL CHECK(priced_events >= 0),
  estimated_events INTEGER NOT NULL CHECK(estimated_events >= 0), unknown_events INTEGER NOT NULL CHECK(unknown_events >= 0),
  cost_complete INTEGER NOT NULL CHECK(cost_complete IN (0,1)), status TEXT NOT NULL CHECK(status IN ('available','interrupted','lost','unavailable')),
  status_reason_code TEXT, resume_available INTEGER NOT NULL CHECK(resume_available IN (0,1)),
  PRIMARY KEY(snapshot_id,source_id,session_id)
) STRICT;
CREATE INDEX idx_sessions_time ON sessions(snapshot_id,started_at_ms DESC);
CREATE INDEX idx_sessions_source_time ON sessions(snapshot_id,source_id,started_at_ms DESC);
CREATE INDEX idx_sessions_project ON sessions(snapshot_id,project_key);
CREATE INDEX idx_sessions_status ON sessions(snapshot_id,status);
CREATE INDEX idx_sessions_tokens ON sessions(snapshot_id,total_tokens DESC);
CREATE TABLE session_unknown_models (
  snapshot_id TEXT NOT NULL, source_id TEXT NOT NULL, session_id TEXT NOT NULL, model_id TEXT NOT NULL,
  PRIMARY KEY(snapshot_id,source_id,session_id,model_id),
  FOREIGN KEY(snapshot_id,source_id,session_id) REFERENCES sessions(snapshot_id,source_id,session_id) ON DELETE CASCADE
) STRICT;
CREATE TABLE session_daily_density (
  snapshot_id TEXT NOT NULL REFERENCES snapshot_generations(snapshot_id) ON DELETE CASCADE, date_key TEXT NOT NULL,
  source_id TEXT NOT NULL, session_count INTEGER NOT NULL CHECK(session_count >= 0), turns INTEGER NOT NULL CHECK(turns >= 0),
  edit_turns INTEGER NOT NULL CHECK(edit_turns >= 0), subagent_calls INTEGER NOT NULL CHECK(subagent_calls >= 0),
  total_tokens INTEGER NOT NULL CHECK(total_tokens >= 0), known_microusd INTEGER NOT NULL CHECK(known_microusd >= 0),
  PRIMARY KEY(snapshot_id,date_key,source_id)
) STRICT;

CREATE TABLE agent_installations (
  snapshot_id TEXT NOT NULL REFERENCES snapshot_generations(snapshot_id) ON DELETE CASCADE, agent_id TEXT NOT NULL,
  installed INTEGER NOT NULL CHECK(installed IN (0,1)), executable_found INTEGER NOT NULL CHECK(executable_found IN (0,1)),
  root_count INTEGER NOT NULL CHECK(root_count >= 0), PRIMARY KEY(snapshot_id,agent_id)
) STRICT;
CREATE TABLE agent_installation_paths (
  snapshot_id TEXT NOT NULL, agent_id TEXT NOT NULL, relative_path TEXT NOT NULL CHECK(
    relative_path LIKE '~/%' AND relative_path NOT GLOB '[A-Za-z]:*' AND relative_path NOT LIKE '/%' AND relative_path NOT LIKE '\\%'
  ), PRIMARY KEY(snapshot_id,agent_id,relative_path),
  FOREIGN KEY(snapshot_id,agent_id) REFERENCES agent_installations(snapshot_id,agent_id) ON DELETE CASCADE
) STRICT;
CREATE TABLE skills (
  snapshot_id TEXT NOT NULL REFERENCES snapshot_generations(snapshot_id) ON DELETE CASCADE, skill_id TEXT NOT NULL,
  name TEXT NOT NULL, description TEXT, last_used_at_ms INTEGER CHECK(last_used_at_ms IS NULL OR last_used_at_ms >= 0),
  size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0), token_estimate INTEGER NOT NULL CHECK(token_estimate >= 0),
  PRIMARY KEY(snapshot_id,skill_id)
) STRICT;
CREATE INDEX idx_skills_last_used ON skills(snapshot_id,last_used_at_ms DESC);
CREATE INDEX idx_skills_name ON skills(snapshot_id,name);
CREATE TABLE skill_installations (
  snapshot_id TEXT NOT NULL, skill_id TEXT NOT NULL, installation_ref TEXT NOT NULL, agent_id TEXT NOT NULL,
  installed_at_ms INTEGER NOT NULL CHECK(installed_at_ms >= 0), modified_at_ms INTEGER NOT NULL CHECK(modified_at_ms >= 0),
  version TEXT, source_kind TEXT CHECK(source_kind IS NULL OR source_kind IN ('frontmatter','market')), source_label TEXT,
  update_status TEXT NOT NULL CHECK(update_status IN ('current','available','unknown')), update_reason_code TEXT NOT NULL,
  PRIMARY KEY(snapshot_id,skill_id,installation_ref),
  FOREIGN KEY(snapshot_id,skill_id) REFERENCES skills(snapshot_id,skill_id) ON DELETE CASCADE
) STRICT;
CREATE TABLE skill_blacklist (
  snapshot_id TEXT NOT NULL REFERENCES snapshot_generations(snapshot_id) ON DELETE CASCADE, skill_name TEXT NOT NULL,
  PRIMARY KEY(snapshot_id,skill_name)
) STRICT;
`;

/** Ordered, immutable migration list consumed by `runMigrations`. */
export const MIGRATIONS: readonly MigrationDefinition[] = [
  {
    version: 1,
    name: "0001_platform",
    sql: PLATFORM_MIGRATION_0001_SQL,
  },
  {
    version: 2,
    name: "0002_low_risk_state",
    sql: PLATFORM_MIGRATION_0002_SQL,
  },
  {
    version: 3,
    name: "0003_snapshot_read_models",
    sql: PLATFORM_MIGRATION_0003_SQL,
  },
  {
    version: 4,
    name: "0004_business_assets",
    sql: PLATFORM_MIGRATION_0004_SQL,
  },
  {
    version: 5,
    name: "0005_search_wsl",
    sql: PLATFORM_MIGRATION_0005_SQL,
  },
  {
    version: 6,
    name: "0006_memory_body",
    sql: PLATFORM_MIGRATION_0006_SQL,
  },
  {
    version: 7,
    name: "0007_model_profile_auth",
    sql: PLATFORM_MIGRATION_0007_SQL,
  },
  {
    version: 8,
    name: "0008_skill_form",
    sql: PLATFORM_MIGRATION_0008_SQL,
  },
];

/** Highest version this build knows how to migrate to. */
export const LATEST_MIGRATION_VERSION = 8;
