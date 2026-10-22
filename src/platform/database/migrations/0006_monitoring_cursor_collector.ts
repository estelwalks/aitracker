/**
 * Migration 0006: the opt-in Cursor account collector joins the monitoring
 * status projection.
 *
 * `monitoring_collectors` pins its `collector_id` values in a CHECK constraint,
 * so a new collector cannot be inserted until the table accepts it. SQLite
 * cannot alter a CHECK constraint, so this migration rebuilds the table with
 * the extended id list and copies the existing rows over. No other schema in
 * this table changes and no data is dropped.
 *
 * The table is a renderer-safe operational projection only (collector state and
 * timestamps); it never holds paths, command text, or source evidence.
 */
export const MONITORING_CURSOR_COLLECTOR_SQL = `-- AITracker local storage database — monitoring collector ids.
CREATE TABLE monitoring_collectors_next (
  collector_id TEXT PRIMARY KEY CHECK (collector_id IN ('usage', 'cursor', 'skills', 'sessions', 'security', 'exchange', 'installation')),
  state TEXT NOT NULL CHECK (state IN ('idle', 'running', 'healthy', 'degraded', 'failed')),
  pending INTEGER NOT NULL CHECK (pending IN (0, 1)),
  last_started_at_ms INTEGER CHECK (last_started_at_ms IS NULL OR last_started_at_ms >= 0),
  last_succeeded_at_ms INTEGER CHECK (last_succeeded_at_ms IS NULL OR last_succeeded_at_ms >= 0),
  last_failed_at_ms INTEGER CHECK (last_failed_at_ms IS NULL OR last_failed_at_ms >= 0),
  error_code TEXT
) STRICT;

INSERT INTO monitoring_collectors_next (
  collector_id, state, pending,
  last_started_at_ms, last_succeeded_at_ms, last_failed_at_ms, error_code
)
SELECT
  collector_id, state, pending,
  last_started_at_ms, last_succeeded_at_ms, last_failed_at_ms, error_code
FROM monitoring_collectors;

DROP TABLE monitoring_collectors;

ALTER TABLE monitoring_collectors_next RENAME TO monitoring_collectors;
`;
