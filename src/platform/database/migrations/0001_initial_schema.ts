/**
 * Complete AITracker database schema for a fresh installation.
 *
 * This unpublished product intentionally has no historical upgrade, backfill,
 * or rollback path. Future schema changes must be added as version 2+.
 */
export const INITIAL_SCHEMA_SQL = `-- AITracker local storage database — initial schema baseline.
-- Fresh-install only: no historical upgrade, backfill, or rollback logic.

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
    protocol IN ('openai', 'openai-responses', 'anthropic')
  ),
  endpoint TEXT,
  model TEXT,
  auth TEXT CHECK (auth IS NULL OR auth IN ('x-api-key', 'bearer')),
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
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  failure_detail TEXT
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

CREATE TABLE insight_refresh_runs (
  run_id TEXT PRIMARY KEY,
  active_slot TEXT UNIQUE,
  locale TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK (generation >= 1),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed')),
  total_items INTEGER NOT NULL CHECK (total_items >= 0),
  completed_items INTEGER NOT NULL DEFAULT 0 CHECK (completed_items >= 0),
  failed_items INTEGER NOT NULL DEFAULT 0 CHECK (failed_items >= 0),
  skipped_items INTEGER NOT NULL DEFAULT 0 CHECK (skipped_items >= 0),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  started_at_ms INTEGER CHECK (started_at_ms IS NULL OR started_at_ms >= 0),
  finished_at_ms INTEGER CHECK (finished_at_ms IS NULL OR finished_at_ms >= 0)
) STRICT;

CREATE INDEX idx_insight_refresh_runs_created
  ON insight_refresh_runs (created_at_ms DESC);

CREATE TABLE insight_refresh_items (
  run_id TEXT NOT NULL REFERENCES insight_refresh_runs (run_id) ON DELETE CASCADE,
  surface_id TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('queued', 'running', 'completed', 'failed', 'skipped')
  ),
  result_status TEXT,
  started_at_ms INTEGER CHECK (started_at_ms IS NULL OR started_at_ms >= 0),
  finished_at_ms INTEGER CHECK (finished_at_ms IS NULL OR finished_at_ms >= 0),
  result_detail TEXT,
  PRIMARY KEY (run_id, surface_id, scope_json)
) STRICT;

CREATE TABLE insight_generation_reservations (
  reservation_key TEXT PRIMARY KEY,
  generation INTEGER NOT NULL CHECK (generation >= 0),
  time_bucket INTEGER NOT NULL CHECK (time_bucket >= 0),
  surface_id TEXT NOT NULL,
  scope_hash TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  locale TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  prompt_version_id TEXT NOT NULL,
  prompt_version INTEGER NOT NULL CHECK (prompt_version >= 0),
  owner_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  result_status TEXT,
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  finished_at_ms INTEGER CHECK (finished_at_ms IS NULL OR finished_at_ms >= 0)
) STRICT;

CREATE INDEX idx_insight_generation_reservations_identity
  ON insight_generation_reservations (
    surface_id, scope_hash, evidence_hash, locale, profile_id
  );

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
  form TEXT CHECK(form IS NULL OR form IN ('package','workflow','prompt')),
  PRIMARY KEY(snapshot_id,skill_id)
) STRICT;
CREATE INDEX idx_skills_last_used ON skills(snapshot_id,last_used_at_ms DESC);
CREATE INDEX idx_skills_name ON skills(snapshot_id,name);
CREATE TABLE skill_installations (
  snapshot_id TEXT NOT NULL, skill_id TEXT NOT NULL, installation_ref TEXT NOT NULL, agent_id TEXT NOT NULL,
  installed_at_ms INTEGER NOT NULL CHECK(installed_at_ms >= 0), modified_at_ms INTEGER NOT NULL CHECK(modified_at_ms >= 0),
  version TEXT, source_kind TEXT CHECK(source_kind IS NULL OR source_kind IN ('frontmatter','market')), source_label TEXT,
  update_status TEXT NOT NULL CHECK(update_status IN ('current','available','unknown')), update_reason_code TEXT NOT NULL,
  directory_name TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(snapshot_id,skill_id,installation_ref),
  FOREIGN KEY(snapshot_id,skill_id) REFERENCES skills(snapshot_id,skill_id) ON DELETE CASCADE
) STRICT;
CREATE TABLE skill_blacklist (
  snapshot_id TEXT NOT NULL REFERENCES snapshot_generations(snapshot_id) ON DELETE CASCADE, skill_name TEXT NOT NULL,
  PRIMARY KEY(snapshot_id,skill_name)
) STRICT;

CREATE TABLE report_runs (
  run_id TEXT PRIMARY KEY,
  task_run_id TEXT REFERENCES task_runs (run_id) ON DELETE SET NULL,
  definition_id TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'schedule')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'offline', 'budget-exceeded')),
  started_at_ms INTEGER NOT NULL CHECK (started_at_ms >= 0),
  finished_at_ms INTEGER CHECK (finished_at_ms IS NULL OR finished_at_ms >= 0),
  error_code TEXT,
  retryable INTEGER CHECK (retryable IS NULL OR retryable IN (0, 1)),
  ai_request_id TEXT REFERENCES ai_executions (request_id) ON DELETE SET NULL
) STRICT;

CREATE INDEX idx_report_runs_definition_started
  ON report_runs (definition_id, started_at_ms DESC);

CREATE TABLE report_run_evidence (
  run_id TEXT NOT NULL REFERENCES report_runs (run_id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  module TEXT NOT NULL CHECK (module IN ('usage', 'insights', 'security', 'knowledge', 'tasks')),
  evidence_ref TEXT NOT NULL,
  observed_at_ms INTEGER NOT NULL CHECK (observed_at_ms >= 0),
  PRIMARY KEY (run_id, sequence)
) STRICT;

CREATE TABLE reports (
  report_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE REFERENCES report_runs (run_id) ON DELETE CASCADE,
  definition_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'archived')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 256),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 60000),
  generated_at_ms INTEGER NOT NULL CHECK (generated_at_ms >= 0),
  template_version INTEGER NOT NULL CHECK (template_version >= 0),
  approved_by TEXT,
  approved_at_ms INTEGER CHECK (approved_at_ms IS NULL OR approved_at_ms >= 0),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
) STRICT;

CREATE INDEX idx_reports_definition_generated
  ON reports (definition_id, generated_at_ms DESC);

CREATE TABLE report_evidence (
  report_id TEXT NOT NULL REFERENCES reports (report_id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  module TEXT NOT NULL CHECK (module IN ('usage', 'insights', 'security', 'knowledge', 'tasks')),
  evidence_ref TEXT NOT NULL,
  observed_at_ms INTEGER NOT NULL CHECK (observed_at_ms >= 0),
  PRIMARY KEY (report_id, sequence)
) STRICT;

CREATE TABLE report_assets (
  report_id TEXT NOT NULL REFERENCES reports (report_id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('knowledge', 'chart', 'attachment')),
  PRIMARY KEY (report_id, asset_id, kind)
) STRICT;

CREATE TABLE knowledge_assets (
  asset_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('memory', 'brief', 'snippet', 'document', 'other')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 256),
  current_version INTEGER NOT NULL CHECK (current_version > 0),
  status TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'published', 'archived')),
  security_verdict TEXT CHECK (security_verdict IS NULL OR security_verdict IN ('clean', 'suspicious', 'dangerous', 'unknown')),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0),
  revision INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;

CREATE TABLE knowledge_metadata (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  revision INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;

INSERT INTO knowledge_metadata (singleton_id, revision) VALUES (1, 0);

CREATE INDEX idx_knowledge_assets_status_kind_updated
  ON knowledge_assets (status, kind, updated_at_ms DESC, asset_id DESC);

CREATE TABLE knowledge_versions (
  version_id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES knowledge_assets (asset_id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  kind TEXT NOT NULL CHECK (kind IN ('memory', 'brief', 'snippet', 'document', 'other')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 256),
  content_ref TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  content TEXT CHECK (content IS NULL OR length(content) <= 24000),
  created_by TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'published', 'archived')),
  security_verdict TEXT CHECK (security_verdict IS NULL OR security_verdict IN ('clean', 'suspicious', 'dangerous', 'unknown')),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0),
  audit_action TEXT NOT NULL,
  audit_actor TEXT NOT NULL,
  UNIQUE (asset_id, version)
) STRICT;

CREATE INDEX idx_knowledge_versions_content_hash
  ON knowledge_versions (content_hash);

CREATE TABLE knowledge_provenance (
  version_id TEXT NOT NULL REFERENCES knowledge_versions (version_id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  source_ref TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('session', 'report', 'distillation', 'manual', 'unknown')),
  captured_at_ms INTEGER NOT NULL CHECK (captured_at_ms >= 0),
  summary TEXT CHECK (summary IS NULL OR length(summary) <= 160),
  PRIMARY KEY (version_id, sequence)
) STRICT;

CREATE INDEX idx_knowledge_provenance_source_ref
  ON knowledge_provenance (source_ref);

CREATE TABLE distillation_candidates (
  candidate_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('memory', 'brief', 'prompt', 'persona', 'skill')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  summary TEXT NOT NULL CHECK (length(summary) <= 16000),
  mode TEXT NOT NULL CHECK (mode IN ('model', 'offline', 'fallback', 'budget-exceeded')),
  approval_state TEXT NOT NULL CHECK (approval_state IN ('waiting-approval', 'approved', 'cancelled')),
  generated_at_ms INTEGER NOT NULL CHECK (generated_at_ms >= 0),
  ai_request_id TEXT NOT NULL UNIQUE REFERENCES ai_executions (request_id) ON DELETE RESTRICT,
  execution_model_id TEXT NOT NULL,
  execution_provider_id TEXT,
  execution_prompt_version_id TEXT NOT NULL,
  execution_prompt_version INTEGER NOT NULL CHECK (execution_prompt_version >= 0),
  execution_status TEXT NOT NULL CHECK (execution_status IN ('completed', 'offline', 'fallback', 'budget-exceeded', 'timeout', 'cancelled', 'failed')),
  execution_used_fallback INTEGER NOT NULL CHECK (execution_used_fallback IN (0, 1)),
  execution_cost_confidence TEXT NOT NULL CHECK (execution_cost_confidence IN ('exact', 'estimated', 'unknown')),
  execution_cost_microusd INTEGER CHECK (execution_cost_microusd IS NULL OR execution_cost_microusd >= 0),
  execution_cost_reason TEXT NOT NULL CHECK (execution_cost_reason IN ('priced', 'estimated', 'no-pricing', 'offline')),
  execution_error_code TEXT,
  approved_at_ms INTEGER CHECK (approved_at_ms IS NULL OR approved_at_ms >= 0),
  cancelled_at_ms INTEGER CHECK (cancelled_at_ms IS NULL OR cancelled_at_ms >= 0),
  knowledge_asset_id TEXT REFERENCES knowledge_assets (asset_id) ON DELETE SET NULL
) STRICT;

CREATE INDEX idx_distillation_candidates_state_generated
  ON distillation_candidates (approval_state, generated_at_ms DESC);

CREATE TABLE distillation_candidate_sessions (
  candidate_id TEXT NOT NULL REFERENCES distillation_candidates (candidate_id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence BETWEEN 0 AND 7),
  source_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  PRIMARY KEY (candidate_id, sequence)
) STRICT;

CREATE TABLE security_scan_runs (
  scan_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('quick', 'full')),
  trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'automatic')),
  locale TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'complete', 'partial', 'failed', 'cancelled')),
  started_at_ms INTEGER NOT NULL CHECK (started_at_ms >= 0),
  finished_at_ms INTEGER CHECK (finished_at_ms IS NULL OR finished_at_ms >= 0),
  discovered_count INTEGER NOT NULL DEFAULT 0 CHECK (discovered_count >= 0),
  queued_count INTEGER NOT NULL DEFAULT 0 CHECK (queued_count >= 0),
  completed_count INTEGER NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  skipped_count INTEGER NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  error_code TEXT,
  rule_version TEXT
) STRICT;

CREATE INDEX idx_security_scan_runs_started
  ON security_scan_runs (started_at_ms DESC);
CREATE INDEX idx_security_scan_runs_status_started
  ON security_scan_runs (status, started_at_ms);

CREATE TABLE security_assessments (
  assessment_ref TEXT PRIMARY KEY,
  scan_id TEXT REFERENCES security_scan_runs (scan_id) ON DELETE SET NULL,
  asset_ref TEXT NOT NULL,
  asset_hash_ref TEXT,
  asset_kind TEXT NOT NULL CHECK (asset_kind IN ('skill', 'package', 'knowledge', 'distillation')),
  display_name TEXT,
  verdict TEXT NOT NULL CHECK (verdict IN ('clean', 'suspicious', 'dangerous', 'unknown')),
  status TEXT NOT NULL CHECK (status IN ('complete', 'partial', 'failed', 'skipped', 'cancelled')),
  rule_version TEXT NOT NULL,
  rule_provenance TEXT NOT NULL CHECK (rule_provenance IN ('builtin', 'local', 'unknown')),
  rule_pack_ref TEXT,
  assessed_at_ms INTEGER NOT NULL CHECK (assessed_at_ms >= 0),
  files_scanned INTEGER CHECK (files_scanned IS NULL OR files_scanned >= 0),
  evidence_count INTEGER NOT NULL CHECK (evidence_count >= 0),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  error_code TEXT
) STRICT;

CREATE INDEX idx_security_assessments_asset_assessed
  ON security_assessments (asset_ref, assessed_at_ms DESC);
CREATE INDEX idx_security_assessments_verdict_assessed
  ON security_assessments (verdict, assessed_at_ms DESC);
CREATE INDEX idx_security_assessments_scan
  ON security_assessments (scan_id);

CREATE TABLE security_findings (
  finding_ref TEXT PRIMARY KEY,
  assessment_ref TEXT NOT NULL REFERENCES security_assessments (assessment_ref) ON DELETE CASCADE,
  severity TEXT NOT NULL CHECK (severity IN ('high', 'medium', 'low')),
  status TEXT NOT NULL CHECK (status IN ('active', 'resolved')),
  dimension TEXT,
  rule_id TEXT,
  evidence_ref TEXT NOT NULL,
  title_key TEXT,
  detail_params_json TEXT CHECK (detail_params_json IS NULL OR json_valid(detail_params_json))
) STRICT;

CREATE INDEX idx_security_findings_assessment_severity
  ON security_findings (assessment_ref, severity);
CREATE INDEX idx_security_findings_status_severity
  ON security_findings (status, severity);

CREATE TABLE distribution_runs (
  run_id TEXT PRIMARY KEY,
  plan_ref TEXT NOT NULL,
  skill_ref TEXT,
  operation TEXT NOT NULL DEFAULT 'install' CHECK (operation IN ('install', 'sync', 'uninstall', 'export')),
  status TEXT NOT NULL CHECK (status IN ('planned', 'running', 'succeeded', 'partial', 'failed', 'rolled-back')),
  requested_at_ms INTEGER NOT NULL CHECK (requested_at_ms >= 0),
  finished_at_ms INTEGER CHECK (finished_at_ms IS NULL OR finished_at_ms >= 0),
  actor TEXT NOT NULL DEFAULT 'local',
  rollback_ref TEXT,
  error_code TEXT
) STRICT;

CREATE INDEX idx_distribution_runs_requested
  ON distribution_runs (requested_at_ms DESC);

CREATE TABLE distribution_run_targets (
  run_id TEXT NOT NULL REFERENCES distribution_runs (run_id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed', 'rolled-back', 'skipped')),
  installation_ref TEXT,
  error_code TEXT,
  backup_ref TEXT,
  PRIMARY KEY (run_id, agent_id)
) STRICT;

CREATE VIEW v_latest_security_assessment AS
SELECT a.* FROM security_assessments a
WHERE NOT EXISTS (
  SELECT 1 FROM security_assessments newer
  WHERE newer.asset_ref = a.asset_ref
    AND (newer.assessed_at_ms > a.assessed_at_ms
      OR (newer.assessed_at_ms = a.assessed_at_ms AND newer.assessment_ref > a.assessment_ref))
);

CREATE VIEW v_latest_reports AS
SELECT r.* FROM reports r
WHERE NOT EXISTS (
  SELECT 1 FROM reports newer
  WHERE newer.definition_id = r.definition_id
    AND (newer.generated_at_ms > r.generated_at_ms
      OR (newer.generated_at_ms = r.generated_at_ms AND newer.report_id > r.report_id))
);

CREATE VIEW v_active_model_profile AS
SELECT profile_id, name, mode, protocol, endpoint, model, is_active, created_at_ms, updated_at_ms
FROM model_profiles WHERE is_active = 1;

CREATE TABLE snapshot_blobs (
  snapshot_id TEXT PRIMARY KEY REFERENCES snapshot_generations (snapshot_id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  payload_bytes INTEGER NOT NULL CHECK (payload_bytes >= 0)
) STRICT;

CREATE TABLE search_documents (
  document_id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('agent', 'skill', 'session', 'report', 'knowledge', 'finding')),
  source_ref TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  tags_json TEXT NOT NULL CHECK (json_valid(tags_json)),
  text_summary TEXT NOT NULL,
  freshness TEXT NOT NULL CHECK (freshness IN ('fresh', 'stale', 'unknown')),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0),
  source_revision TEXT,
  UNIQUE (type, source_ref)
) STRICT;

CREATE INDEX idx_search_documents_type_updated
  ON search_documents (type, updated_at_ms DESC);

CREATE INDEX idx_search_documents_freshness
  ON search_documents (freshness);

CREATE TABLE usage_aggregate_snapshots (
  snapshot_id TEXT PRIMARY KEY REFERENCES snapshot_generations(snapshot_id) ON DELETE CASCADE,
  generated_at_ms INTEGER NOT NULL CHECK(generated_at_ms >= 0),
  event_count INTEGER NOT NULL CHECK(event_count >= 0)
) STRICT;

CREATE TABLE usage_aggregate_sources (
  snapshot_id TEXT NOT NULL REFERENCES usage_aggregate_snapshots(snapshot_id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  available INTEGER NOT NULL CHECK(available IN (0,1)),
  detected INTEGER CHECK(detected IS NULL OR detected IN (0,1)),
  files_considered INTEGER NOT NULL CHECK(files_considered >= 0),
  files_read INTEGER NOT NULL CHECK(files_read >= 0),
  files_reused INTEGER NOT NULL CHECK(files_reused >= 0),
  files_parsed INTEGER NOT NULL CHECK(files_parsed >= 0),
  malformed_lines INTEGER NOT NULL CHECK(malformed_lines >= 0),
  event_count INTEGER NOT NULL CHECK(event_count >= 0),
  PRIMARY KEY(snapshot_id, source_id)
) STRICT;

CREATE TABLE usage_aggregate_source_diagnostics (
  snapshot_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK(sequence >= 0),
  code TEXT NOT NULL,
  count INTEGER NOT NULL CHECK(count >= 0),
  message_key TEXT NOT NULL,
  PRIMARY KEY(snapshot_id, source_id, sequence),
  FOREIGN KEY(snapshot_id, source_id)
    REFERENCES usage_aggregate_sources(snapshot_id, source_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE usage_aggregate_buckets (
  snapshot_id TEXT NOT NULL REFERENCES usage_aggregate_snapshots(snapshot_id) ON DELETE CASCADE,
  bucket_id TEXT NOT NULL,
  date_key TEXT NOT NULL,
  latest_at_ms INTEGER NOT NULL CHECK(latest_at_ms >= 0),
  source_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  project_ref_hash TEXT,
  project_label TEXT NOT NULL,
  project_kind TEXT NOT NULL DEFAULT 'unknown'
    CHECK(project_kind IN ('workspace','quick-conversation','unknown')),
  measurement TEXT NOT NULL CHECK(measurement IN ('observed','estimated')),
  event_count INTEGER NOT NULL CHECK(event_count > 0),
  input_tokens INTEGER NOT NULL CHECK(input_tokens >= 0),
  cached_input_tokens INTEGER NOT NULL CHECK(cached_input_tokens >= 0),
  cache_creation_input_tokens INTEGER NOT NULL CHECK(cache_creation_input_tokens >= 0),
  output_tokens INTEGER NOT NULL CHECK(output_tokens >= 0),
  reasoning_output_tokens INTEGER NOT NULL CHECK(reasoning_output_tokens >= 0),
  total_tokens INTEGER NOT NULL CHECK(total_tokens >= 0),
  text_responses INTEGER NOT NULL CHECK(text_responses >= 0),
  tool_calls INTEGER NOT NULL CHECK(tool_calls >= 0),
  skill_calls INTEGER NOT NULL CHECK(skill_calls >= 0),
  tool_output_calls INTEGER NOT NULL CHECK(tool_output_calls >= 0),
  evidence_text_responses INTEGER NOT NULL CHECK(evidence_text_responses IN (0,1)),
  evidence_tool_calls INTEGER NOT NULL CHECK(evidence_tool_calls IN (0,1)),
  evidence_skill_calls INTEGER NOT NULL CHECK(evidence_skill_calls IN (0,1)),
  evidence_tool_output_calls INTEGER NOT NULL CHECK(evidence_tool_output_calls IN (0,1)),
  evidence_reasoning_tokens INTEGER NOT NULL CHECK(evidence_reasoning_tokens IN (0,1)),
  evidence_system_prompt_tokens INTEGER NOT NULL CHECK(evidence_system_prompt_tokens IN (0,1)),
  PRIMARY KEY(snapshot_id, bucket_id)
) STRICT;

CREATE INDEX idx_usage_aggregate_buckets_date
  ON usage_aggregate_buckets(snapshot_id, date_key);
CREATE INDEX idx_usage_aggregate_buckets_source
  ON usage_aggregate_buckets(snapshot_id, source_id, date_key);
CREATE INDEX idx_usage_aggregate_buckets_model
  ON usage_aggregate_buckets(snapshot_id, model_id, date_key);
CREATE INDEX idx_usage_aggregate_buckets_project
  ON usage_aggregate_buckets(snapshot_id, project_ref_hash, date_key);

CREATE TABLE usage_aggregate_bucket_tools (
  snapshot_id TEXT NOT NULL,
  bucket_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  calls INTEGER NOT NULL CHECK(calls > 0),
  PRIMARY KEY(snapshot_id, bucket_id, name, category),
  FOREIGN KEY(snapshot_id, bucket_id)
    REFERENCES usage_aggregate_buckets(snapshot_id, bucket_id) ON DELETE CASCADE
) STRICT;
CREATE TABLE usage_tracker_buckets (
  snapshot_id TEXT NOT NULL
    REFERENCES usage_aggregate_snapshots(snapshot_id) ON DELETE CASCADE,
  dimension TEXT NOT NULL
    CHECK(dimension IN ('project','session','skill')),
  entity_key TEXT NOT NULL,
  entity_label TEXT NOT NULL,
  project_kind TEXT
    CHECK(project_kind IS NULL OR project_kind IN ('workspace','quick-conversation','unknown')),
  source_id TEXT NOT NULL,
  date_key TEXT NOT NULL,
  event_count INTEGER NOT NULL CHECK(event_count > 0),
  calls INTEGER NOT NULL CHECK(calls >= 0),
  input_tokens REAL NOT NULL CHECK(input_tokens >= 0),
  cached_input_tokens REAL NOT NULL CHECK(cached_input_tokens >= 0),
  cache_creation_input_tokens REAL NOT NULL CHECK(cache_creation_input_tokens >= 0),
  output_tokens REAL NOT NULL CHECK(output_tokens >= 0),
  reasoning_output_tokens REAL NOT NULL CHECK(reasoning_output_tokens >= 0),
  total_tokens REAL NOT NULL CHECK(total_tokens >= 0),
  PRIMARY KEY(snapshot_id, dimension, entity_key, source_id, date_key)
) STRICT;

CREATE INDEX idx_usage_tracker_dimension_tokens
  ON usage_tracker_buckets(snapshot_id, dimension, total_tokens DESC);
CREATE INDEX idx_usage_tracker_dimension_date
  ON usage_tracker_buckets(snapshot_id, dimension, date_key);
`;
