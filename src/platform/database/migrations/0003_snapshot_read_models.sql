-- AITracker local storage database — migration 0003 "snapshot read models".
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
