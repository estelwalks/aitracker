// Read-only database inspection (Story S-04, T-04-02; tightened in review
// batch B, finding P2-13).
//
// Usage: node scripts/inspect-database.mts <databasePath> [--verbose]
//
// Opens the database with the SAME strict connection options the platform
// adapter uses (read-only), and prints ONLY health metadata, the schema object
// list, per-table row counts and the index count. It NEVER prints row contents
// — no business field values, no `SELECT` beyond `count(*)` and the metadata
// pragmas — and it never echoes an absolute path or a raw driver message:
//   * the inspected file is reported by base name only, so a shared terminal
//     log cannot leak `C:\Users\<name>\…`;
//   * failures are reported as a stable classification (`not-found`,
//     `not-a-database`, `access-denied`, `busy`, `io-failure`,
//     `integrity-check-failed`), never as the driver's own text.
//
// Any unrecognized argument is a usage error: the previous version treated
// `--verbos` (a typo) as the database path and reported "cannot open".
//
// Exit code 0 on success; 1 on usage error, a missing/unreadable/foreign file,
// or a failed integrity_check.
import { existsSync, statSync } from "node:fs";
import { basename } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Verbatim copy of `NODE_SQLITE_CONNECTION_OPTIONS` from
 * `src/platform/database/infrastructure/node-sqlite-database.server.ts`, plus
 * `readOnly`. This script deliberately imports nothing from `src/` so it runs
 * under bare `node` without tsx or a build; keep the two in sync when the
 * platform option set changes (ADR decision 6 / architecture §3.2).
 */
const READ_ONLY_CONNECTION_OPTIONS = {
  readOnly: true,
  timeout: 5000,
  readBigInts: true,
  allowExtension: false,
  allowBareNamedParameters: false,
  allowUnknownNamedParameters: false,
  defensive: true,
} as const;

const USAGE =
  "usage: node scripts/inspect-database.mts <databasePath> [--verbose]";

interface Arguments {
  readonly path: string;
  readonly verbose: boolean;
}

/** Parses argv strictly: exactly one path, only the `--verbose` flag. */
function parseArgs(argv: string[]): Arguments | undefined {
  let verbose = false;
  const positionals: string[] = [];
  for (const arg of argv) {
    if (arg === "--verbose") {
      verbose = true;
      continue;
    }
    if (arg.startsWith("-")) {
      console.error(`inspect-database: unknown option: ${arg}`);
      console.error(USAGE);
      return undefined;
    }
    positionals.push(arg);
  }
  if (positionals.length === 0) {
    console.error("inspect-database: a database path is required");
    console.error(USAGE);
    return undefined;
  }
  if (positionals.length > 1) {
    console.error("inspect-database: exactly one database path is accepted");
    console.error(USAGE);
    return undefined;
  }
  return { path: positionals[0], verbose };
}

/** Escapes a schema-derived identifier for a safe `SELECT count(*) FROM "…"`. */
function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Stable failure classification. The driver message is intentionally discarded:
 * it can contain the absolute database path and internal offsets.
 */
function classifyOpenFailure(error: unknown): string {
  const candidate = error as { errcode?: unknown; message?: unknown };
  const primary =
    typeof candidate.errcode === "number" ? candidate.errcode & 0xff : 0;
  const text =
    typeof candidate.message === "string"
      ? candidate.message.toLowerCase()
      : "";
  if (
    primary === 26 /* SQLITE_NOTADB */ ||
    primary === 11 /* SQLITE_CORRUPT */ ||
    text.includes("file is not a database") ||
    text.includes("database disk image is malformed")
  ) {
    return "not-a-database";
  }
  if (primary === 8 /* SQLITE_READONLY */ || text.includes("permission")) {
    return "access-denied";
  }
  if (primary === 5 /* SQLITE_BUSY */ || text.includes("database is locked")) {
    return "busy";
  }
  if (
    primary === 14 /* SQLITE_CANTOPEN */ ||
    text.includes("unable to open database file")
  ) {
    return "io-failure";
  }
  return "unexpected-failure";
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
  const args = parseArgs(process.argv.slice(2));
  if (args === undefined) {
    process.exitCode = 1;
    return;
  }
  // The report identifies the file by base name only — never the full path.
  const displayName = basename(args.path);

  if (!existsSync(args.path) || !statSync(args.path).isFile()) {
    console.error(`inspect-database: ${displayName}: not-found`);
    process.exitCode = 1;
    return;
  }

  let database: DatabaseSync;
  try {
    database = new DatabaseSync(args.path, READ_ONLY_CONNECTION_OPTIONS);
  } catch (error) {
    console.error(
      `inspect-database: ${displayName}: ${classifyOpenFailure(error)}`,
    );
    process.exitCode = 1;
    return;
  }

  try {
    console.log(`database: ${displayName}`);
    console.log(
      scalarText(database, "SELECT sqlite_version() AS v", "sqlite_version"),
    );
    console.log(scalarText(database, "PRAGMA journal_mode", "journal_mode"));
    console.log(scalarText(database, "PRAGMA foreign_keys", "foreign_keys"));
    console.log(scalarText(database, "PRAGMA user_version", "user_version"));
    console.log(
      scalarText(database, "PRAGMA application_id", "application_id"),
    );

    const integrity = scalarText(
      database,
      "PRAGMA integrity_check",
      "integrity_check",
    );
    console.log(integrity);
    if (!integrity.endsWith("integrity_check: ok")) {
      console.error(`inspect-database: ${displayName}: integrity-check-failed`);
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
    for (const name of tableNames) {
      const row = database
        .prepare(`SELECT count(*) AS n FROM ${quoteIdentifier(name)}`)
        .get();
      const count = row === undefined ? 0 : Object.values(row)[0];
      if (args.verbose) {
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
  } catch (error) {
    console.error(
      `inspect-database: ${displayName}: ${classifyOpenFailure(error)}`,
    );
    process.exitCode = 1;
  } finally {
    database.close();
  }
}

main();
