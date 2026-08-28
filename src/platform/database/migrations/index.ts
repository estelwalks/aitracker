/** Ordered, immutable database migrations. */
import { INITIAL_SCHEMA_SQL } from "./0001_initial_schema.ts";

export { INITIAL_SCHEMA_SQL } from "./0001_initial_schema.ts";

export interface MigrationDefinition {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

/** Fresh-release baseline. No historical upgrade migrations are shipped. */
export const MIGRATIONS: readonly MigrationDefinition[] = [
  {
    version: 1,
    name: "0001_initial_schema",
    sql: INITIAL_SCHEMA_SQL,
  },
];

export const LATEST_MIGRATION_VERSION = 1;
