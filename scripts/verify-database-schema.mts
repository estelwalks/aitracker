import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import {
  DROP_LEGACY_USAGE_TABLES_SQL,
  INITIAL_SCHEMA_SQL,
  LATEST_MIGRATION_VERSION,
  MIGRATIONS,
} from "../src/platform/database/migrations/index.ts";

const migrationsDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "platform",
  "database",
  "migrations",
);

const REQUIRED_TABLES = [
  "schema_migrations",
  "app_preferences",
  "runtime_flags",
  "secure_secrets",
  "model_profiles",
  "ai_executions",
  "ai_daily_usage",
  "insight_preferences",
  "insight_enhancement_cache",
  "insight_enhancement_lines",
  "insight_refresh_runs",
  "insight_refresh_items",
  "insight_generation_reservations",
  "task_preferences",
  "task_runs",
  "monitoring_state",
  "monitoring_collectors",
  "http_cache_entries",
  "snapshot_generations",
  "snapshot_heads",
  "snapshot_warnings",
  "project_classifications",
  "sessions",
  "session_unknown_models",
  "session_daily_density",
  "agent_installations",
  "agent_installation_paths",
  "skills",
  "skill_installations",
  "skill_blacklist",
  "report_runs",
  "report_run_evidence",
  "reports",
  "report_evidence",
  "report_assets",
  "knowledge_assets",
  "knowledge_metadata",
  "knowledge_versions",
  "knowledge_provenance",
  "distillation_candidates",
  "distillation_candidate_sessions",
  "security_scan_runs",
  "security_assessments",
  "security_findings",
  "distribution_runs",
  "distribution_run_targets",
  "snapshot_blobs",
  "search_documents",
  "usage_aggregate_snapshots",
  "usage_aggregate_sources",
  "usage_aggregate_source_diagnostics",
  "usage_aggregate_buckets",
  "usage_aggregate_bucket_tools",
  "usage_tracker_buckets",
] as const;

/**
 * Legacy usage snapshot tables removed by migration 0002 (P2-14). Production
 * never read or wrote them; they must be absent from the final schema.
 */
const LEGACY_USAGE_TABLES = [
  "usage_sources",
  "usage_source_diagnostics",
  "usage_events",
  "usage_event_tool_calls",
  "usage_event_skill_calls",
  "usage_event_command_stats",
  "usage_event_output_summaries",
  "usage_daily_aggregates",
] as const;

const REQUIRED_VIEWS = [
  "v_active_model_profile",
  "v_latest_reports",
  "v_latest_security_assessment",
] as const;

function scalar(database: DatabaseSync, sql: string): unknown {
  const row = database.prepare(sql).get();
  assert.ok(row);
  return Object.values(row)[0];
}

const files = readdirSync(migrationsDirectory).sort();
assert.deepEqual(files, [
  "0001_initial_schema.ts",
  "0002_drop_legacy_usage_tables.ts",
  "index.ts",
]);
assert.ok(MIGRATIONS.length >= 1, "at least the baseline migration must exist");
assert.deepEqual(MIGRATIONS[0], {
  version: 1,
  name: "0001_initial_schema",
  sql: INITIAL_SCHEMA_SQL,
});
assert.equal(
  MIGRATIONS.find((migration) => migration.version === 2)?.name,
  "0002_drop_legacy_usage_tables",
  "migration 0002 must drop the legacy usage tables",
);
assert.equal(
  LATEST_MIGRATION_VERSION,
  MIGRATIONS[MIGRATIONS.length - 1].version,
);
assert.doesNotMatch(INITIAL_SCHEMA_SQL, /ALTER\s+TABLE/i);
assert.doesNotMatch(INITIAL_SCHEMA_SQL, /PRAGMA\s+user_version/i);
assert.equal(
  [...INITIAL_SCHEMA_SQL.matchAll(/PRAGMA\s+application_id\s*=\s*0x54544442/gi)]
    .length,
  1,
);

const database = new DatabaseSync(":memory:");
try {
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec(INITIAL_SCHEMA_SQL);
  database.exec(DROP_LEGACY_USAGE_TABLES_SQL);

  const objects = database
    .prepare(
      "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
    )
    .all();
  const tables = objects
    .filter((row) => row.type === "table")
    .map((row) => String(row.name))
    .sort();
  const views = objects
    .filter((row) => row.type === "view")
    .map((row) => String(row.name))
    .sort();
  assert.deepEqual(tables, [...REQUIRED_TABLES].sort());
  assert.deepEqual(views, [...REQUIRED_VIEWS].sort());
  for (const legacy of LEGACY_USAGE_TABLES) {
    assert.equal(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .get(legacy),
      undefined,
      `legacy table ${legacy} must be dropped by migration 0002`,
    );
  }
  for (const row of objects.filter((item) => item.type === "table")) {
    assert.match(String(row.sql).trim(), /\)\s*STRICT$/);
  }

  for (const [table, column] of [
    ["model_profiles", "auth"],
    ["knowledge_versions", "content"],
    ["skills", "form"],
    ["usage_aggregate_buckets", "project_kind"],
    ["skill_installations", "directory_name"],
    ["ai_executions", "failure_detail"],
    ["insight_refresh_items", "result_detail"],
  ] as const) {
    assert.ok(
      database
        .prepare(
          `SELECT name FROM pragma_table_info('${table}') WHERE name = ?`,
        )
        .get(column),
      `missing ${table}.${column}`,
    );
  }

  assert.equal(
    database
      .prepare(
        "SELECT name FROM pragma_table_info('model_profiles') WHERE name = 'api_format'",
      )
      .get(),
    undefined,
  );
  assert.match(
    String(
      database
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'model_profiles'",
        )
        .get()?.sql,
    ),
    /'openai-responses'/,
  );

  assert.equal(Number(scalar(database, "PRAGMA application_id")), 0x54544442);
  assert.equal(Number(scalar(database, "PRAGMA user_version")), 0);
  assert.equal(
    Number(scalar(database, "SELECT count(*) FROM knowledge_metadata")),
    1,
  );
  assert.equal(String(scalar(database, "PRAGMA integrity_check")), "ok");
  assert.equal(
    Number(scalar(database, "SELECT count(*) FROM pragma_foreign_key_check")),
    0,
  );
} finally {
  database.close();
}

process.stdout.write(
  `Database baseline OK: ${MIGRATIONS.length} migrations, ${REQUIRED_TABLES.length} baseline tables, ${REQUIRED_VIEWS.length} views.\n`,
);
