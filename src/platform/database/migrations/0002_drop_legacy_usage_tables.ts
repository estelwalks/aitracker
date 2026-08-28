/**
 * Migration 0002: drop the legacy usage snapshot tables (P2-14).
 *
 * Migration 0001 created two generations of usage storage: the original
 * event-level tables (`usage_sources` → `usage_events` → `usage_event_*`)
 * and the aggregate projections (`usage_aggregate_*`, `usage_tracker_buckets`)
 * that replaced them. Production code has only ever written and read the
 * aggregate tables; the legacy tables are zero-reference dead schema (only
 * tests and the schema verifier still named them). This migration removes
 * them so a fresh baseline stops carrying the dead weight.
 *
 * Drop order is child-first: `usage_event_*` reference `usage_events`,
 * `usage_source_diagnostics` and `usage_events` reference `usage_sources`.
 * `usage_daily_aggregates` is a leaf over `snapshot_generations` (which is
 * kept), so it can be dropped anywhere. No kept table holds a foreign key
 * back into any of these, so `snapshot_generations` and every aggregate table
 * are untouched.
 */
export const DROP_LEGACY_USAGE_TABLES_SQL = `-- AITracker local storage database — drop legacy usage snapshot tables (P2-14).
-- Children first: usage_event_* → usage_events → usage_sources.

DROP TABLE IF EXISTS usage_event_tool_calls;
DROP TABLE IF EXISTS usage_event_skill_calls;
DROP TABLE IF EXISTS usage_event_command_stats;
DROP TABLE IF EXISTS usage_event_output_summaries;
DROP TABLE IF EXISTS usage_source_diagnostics;
DROP TABLE IF EXISTS usage_events;
DROP TABLE IF EXISTS usage_sources;
DROP TABLE IF EXISTS usage_daily_aggregates;
`;
