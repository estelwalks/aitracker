// Read-only database inspection (Story S-04, T-04-02).
//
// Usage: node scripts/inspect-database.mts <databasePath> [--verbose]
//
// Opens the database with `DatabaseSync(..., { readOnly: true })` and prints
// ONLY health metadata, the schema object list, per-table row counts and the
// index count. It NEVER prints row contents — no business field values, no
// `SELECT` beyond `count(*)` and the metadata pragmas.
//
// Exit code 0 on success; 1 when the path is missing, unreadable, not a valid
// database, or fails integrity_check.
import { DatabaseSync } from "node:sqlite";

function parseArgs(argv: string[]): { path?: string; verbose: boolean } {
  const positionals = argv.filter((arg) => arg !== "--verbose");
  const verbose = argv.includes("--verbose");
  if (positionals.length === 0) {
    console.error(
      "usage: node scripts/inspect-database.mts <databasePath> [--verbose]",
    );
    return { verbose };
  }
  if (positionals.length > 1) {
    console.error("inspect-database: exactly one database path is accepted");
    return { verbose };
  }
  return { path: positionals[0], verbose };
}

/** Escapes a schema-derived identifier for a safe `SELECT count(*) FROM "…"`. */
function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function scalarText(
  database: DatabaseSync,
  sql: string,
  label: string,
): string {
  const row = database.prepare(sql).get();
  const value = row === undefined ? undefined : Object.values(row)[0];
  return value === undefined ? "<none>" : `${label}: ${String(value)}`;
}

function main(): void {
  const { path, verbose } = parseArgs(process.argv.slice(2));
  if (path === undefined) {
    process.exitCode = 1;
    return;
  }

  let database: DatabaseSync;
  try {
    database = new DatabaseSync(path, { readOnly: true });
  } catch (error) {
    console.error(`inspect-database: cannot open ${path} read-only`);
    console.error(
      `  ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
    return;
  }

  try {
    console.log(`database: ${path}`);
    console.log(
      scalarText(database, "SELECT sqlite_version() AS v", "sqlite_version"),
    );
    console.log(scalarText(database, "PRAGMA journal_mode", "journal_mode"));
    console.log(scalarText(database, "PRAGMA foreign_keys", "foreign_keys"));
    console.log(scalarText(database, "PRAGMA user_version", "user_version"));

    const integrity = scalarText(
      database,
      "PRAGMA integrity_check",
      "integrity_check",
    );
    console.log(integrity);
    if (!integrity.endsWith("integrity_check: ok")) {
      console.error("inspect-database: integrity_check did not return ok");
      process.exitCode = 1;
      return;
    }

    // Schema object list: ordinary user tables only (skip SQLite internals),
    // names come from the sqlite_master whitelist.
    const tableRows = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all();
    const tableNames = tableRows.map((row) => String(row.name));

    console.log(`tables: ${tableNames.length}`);
    const rowCounts = new Map<string, number | bigint>();
    for (const name of tableNames) {
      const row = database
        .prepare(`SELECT count(*) AS n FROM ${quoteIdentifier(name)}`)
        .get();
      const count = row === undefined ? 0 : Object.values(row)[0];
      rowCounts.set(
        name,
        typeof count === "number" || typeof count === "bigint" ? count : 0,
      );
      if (verbose) {
        const columns = database
          .prepare(`PRAGMA table_info(${quoteIdentifier(name)})`)
          .all();
        console.log(
          `  ${name}: rows=${String(count)}, columns=${columns.length}`,
        );
      } else {
        console.log(`  ${name}: rows=${String(count)}`);
      }
    }

    const indexRows = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'",
      )
      .all();
    console.log(`indexes: ${indexRows.length}`);
  } finally {
    database.close();
  }
}

main();
