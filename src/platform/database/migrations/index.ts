/** Ordered, immutable database migrations. */
import { INITIAL_SCHEMA_SQL } from "./0001_initial_schema.ts";
import { DROP_LEGACY_USAGE_TABLES_SQL } from "./0002_drop_legacy_usage_tables.ts";

export { INITIAL_SCHEMA_SQL } from "./0001_initial_schema.ts";
export { DROP_LEGACY_USAGE_TABLES_SQL } from "./0002_drop_legacy_usage_tables.ts";

export interface MigrationDefinition {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

/**
 * Ordered migration lineage. 0001 is the fresh-release baseline; 0002 removes
 * the legacy usage snapshot tables that production never reads or writes.
 * Future schema changes must be appended as version 3+.
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
];

export const LATEST_MIGRATION_VERSION = 2;
