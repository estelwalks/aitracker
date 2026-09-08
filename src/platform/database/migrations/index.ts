/** Ordered, immutable database migrations. */
import { INITIAL_SCHEMA_SQL } from "./0001_initial_schema.ts";
import { DROP_LEGACY_USAGE_TABLES_SQL } from "./0002_drop_legacy_usage_tables.ts";
import { TOOL_DATA_ROOTS_SQL } from "./0003_tool_data_roots.ts";

export { INITIAL_SCHEMA_SQL } from "./0001_initial_schema.ts";
export { DROP_LEGACY_USAGE_TABLES_SQL } from "./0002_drop_legacy_usage_tables.ts";
export { TOOL_DATA_ROOTS_SQL } from "./0003_tool_data_roots.ts";

export interface MigrationDefinition {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

/**
 * Ordered migration lineage. 0001 is the fresh-release baseline; 0002 removes
 * the legacy usage snapshot tables that production never reads or writes;
 * 0003 adds the per-tool user data-directory overrides table (privacy
 * carve-out documented in the migration file). Appended as version 3+.
 */
export const MIGRATIONS: readonly MigrationDefinition[] = [
  {
    version: 1,
    name: "0001_initial_schema",
    sql: INITIAL_SCHEMA_SQL,
  },
  {
    version: 2,
    name: "0002_drop_legacy_usage_tables",
    sql: DROP_LEGACY_USAGE_TABLES_SQL,
  },
  {
    version: 3,
    name: "0003_tool_data_roots",
    sql: TOOL_DATA_ROOTS_SQL,
  },
];

export const LATEST_MIGRATION_VERSION = 3;
