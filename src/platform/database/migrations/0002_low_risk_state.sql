-- AITracker local storage database — migration 0002 "low risk state".
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
