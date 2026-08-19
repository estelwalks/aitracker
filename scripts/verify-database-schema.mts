// Static verification gate for the platform database migrations
// (Story S-04, T-04-01).
//
// Usage: node scripts/verify-database-schema.mts [--sql-dir <path>]
//
// Pure Node built-ins (ESM, runs directly under `node`), deliberately NOT
// importing any `src/` module so it never depends on tsx or a running build.
// It therefore re-implements the line-ending normalization and SHA-256
// checksum locally and compares the reviewable `*.sql` files against the
// inline SQL strings inside `migrations/index.ts` at the text level (dual
// source), without executing TypeScript.
//
// Verified facts:
//   1. Migration filenames are `NNNN_name.sql` with strictly increasing NNNN.
//   2. Each `.sql` file is byte-identical (after CRLF→LF + BOM normalization)
//      and SHA-256 identical to its inline `PLATFORM_MIGRATION_<name>_SQL`
//      template literal in `migrations/index.ts`.
//   3. Migration 0001 defines exactly the 11 first-wave STRICT tables with the
//      documented names, and its key constraints/indexes are present.
//   4. Every `*_json` column has a `json_valid(...)` CHECK and every
//      `*_at_ms` column has a non-negative CHECK.
//
// Exit code 0 means OK; 1 means a FAIL was reported.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

/** Default migrations directory, resolved relative to this script. */
const DEFAULT_SQL_DIR = join(
  SCRIPT_DIR,
  "..",
  "src",
  "platform",
  "database",
  "migrations",
);

/** First-wave table names, in creation order (architecture §5.1/§5.2/§5.10). */
const REQUIRED_TABLES = [
  "schema_migrations",
  "data_migration_runs",
  "app_preferences",
  "runtime_flags",
  "secure_secrets",
  "model_profiles",
  "ai_executions",
  "ai_daily_usage",
  "insight_preferences",
  "insight_enhancement_cache",
  "insight_enhancement_lines",
];

interface Problem {
  readonly message: string;
}

interface MigrationFile {
  readonly version: number;
  readonly name: string;
  /** Zero-padded numeric prefix, e.g. `0001`. */
  readonly prefix: string;
  readonly path: string;
}

/** Canonical form shared with migration-runner.server.ts: BOM + CRLF → LF. */
function normalizeSql(sql: string): string {
  return sql.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Squashes runs of whitespace (incl. newlines) to a single space. */
function oneLine(text: string): string {
  return normalizeSql(text).replace(/\s+/g, " ").trim();
}

/**
 * Extracts the raw body of `export const PLATFORM_MIGRATION_<NNNN>_SQL = \`…\``
 * from `migrations/index.ts` (the inline constant is keyed by the numeric
 * prefix, e.g. `PLATFORM_MIGRATION_0001_SQL`). Returns `undefined` when the
 * constant is absent (e.g. a not-yet-inlined migration file).
 */
function extractInlineSql(
  indexTsSource: string,
  prefix: string,
): string | undefined {
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `PLATFORM_MIGRATION_${escapedPrefix}_SQL\\s*=\\s*\`([\\s\\S]*?)\``,
    "g",
  );
  const matches = [...indexTsSource.matchAll(pattern)];
  if (matches.length === 0) return undefined;
  // Last match wins; the source holds a single definition today.
  return matches[matches.length - 1][1];
}

/** Parses `--sql-dir <path>` from argv. */
function parseSqlDir(argv: string[]): string {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--sql-dir") {
      const value = argv[i + 1];
      if (typeof value !== "string" || value === "") {
        throw new Error("--sql-dir requires a directory path argument");
      }
      return value;
    }
  }
  return DEFAULT_SQL_DIR;
}

/** Lists `NNNN_name.sql` migration files and asserts strict version order. */
function listMigrations(sqlDir: string, problems: Problem[]): MigrationFile[] {
  let entries: string[];
  try {
    entries = readdirSync(sqlDir);
  } catch {
    problems.push({ message: `cannot read migrations directory: ${sqlDir}` });
    return [];
  }

  const files = entries
    .filter((entry) => extname(entry) === ".sql")
    .map((entry) => {
      const match = /^(\d{4})_([A-Za-z0-9_]+)\.sql$/.exec(entry);
      if (!match) {
        problems.push({
          message: `migration filename must match NNNN_name.sql: ${entry}`,
        });
        return null;
      }
      return {
        version: Number(match[1]),
        name: `${match[1]}_${match[2]}`,
        prefix: match[1],
        path: join(sqlDir, entry),
      } satisfies MigrationFile;
    })
    .filter((file): file is MigrationFile => file !== null);

  files.sort((a, b) => a.version - b.version);

  const seen = new Set<number>();
  let previous = 0;
  for (const file of files) {
    if (seen.has(file.version)) {
      problems.push({
        message: `duplicate migration version ${String(file.version).padStart(4, "0")}`,
      });
    }
    seen.add(file.version);
    if (file.version <= previous) {
      problems.push({
        message: `migration versions must be strictly increasing: ${String(previous).padStart(4, "0")} then ${String(file.version).padStart(4, "0")}`,
      });
    }
    previous = file.version;
  }

  if (files.length === 0) {
    problems.push({ message: `no NNNN_name.sql migration files in ${sqlDir}` });
  }
  return files;
}

/** Verifies the .sql file matches its inline template literal in index.ts. */
function verifyDualSource(
  file: MigrationFile,
  indexTsSource: string,
  problems: Problem[],
): string | undefined {
  let sqlText: string;
  try {
    sqlText = normalizeSql(readFileSync(file.path, "utf8"));
  } catch {
    problems.push({
      message: `cannot read ${relative(process.cwd(), file.path)}`,
    });
    return undefined;
  }

  const inline = extractInlineSql(indexTsSource, file.prefix);
  if (inline === undefined) {
    problems.push({
      message: `no inline PLATFORM_MIGRATION_${file.prefix}_SQL in migrations/index.ts`,
    });
    return sqlText;
  }

  const inlineText = normalizeSql(inline);
  const fileHash = sha256(sqlText);
  const inlineHash = sha256(inlineText);
  if (fileHash !== inlineHash || sqlText !== inlineText) {
    problems.push({
      message: `dual-source mismatch for ${file.name}: .sql sha256=${fileHash} vs index.ts sha256=${inlineHash}`,
    });
  } else {
    process.stdout.write(
      `  ${file.name}: dual-source OK (sha256 ${fileHash})\n`,
    );
  }
  return sqlText;
}

/** Names of the `CREATE TABLE` blocks, in order of appearance. */
function extractTableNames(sql: string): string[] {
  return [
    ...sql.matchAll(/CREATE\s+TABLE\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g),
  ].map((match) => match[1]);
}

/** Raw text of one `CREATE TABLE name ( … ) STRICT;` block. */
function extractTableBlock(sql: string, tableName: string): string | undefined {
  const start = new RegExp(`CREATE\\s+TABLE\\s+${tableName}\\s*\\(`, "g");
  const beginMatch = start.exec(sql);
  if (!beginMatch) return undefined;
  const openIndex = sql.indexOf("(", beginMatch.index);
  let depth = 0;
  for (let i = openIndex; i < sql.length; i += 1) {
    if (sql[i] === "(") depth += 1;
    else if (sql[i] === ")") {
      depth -= 1;
      if (depth === 0) {
        // Include the trailing `STRICT;`/`;` clause in the block.
        const tail = /^[\s;]*STRICT\s*;/m.exec(sql.slice(i + 1));
        return tail
          ? sql.slice(beginMatch.index, i + 1 + tail.index + tail[0].length)
          : sql.slice(beginMatch.index, i + 1);
      }
    }
  }
  return undefined;
}

/** Column names declared inside a CREATE TABLE block. */
function extractColumnNames(block: string): string[] {
  const names: string[] = [];
  for (const match of block.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s+/gm)) {
    names.push(match[1]);
  }
  return names;
}

/** Verifies 0001's 11-table list + STRICT + key constraints/indexes. */
function verifyPlatform0001(sql: string, problems: Problem[]): void {
  const tableNames = extractTableNames(sql);
  const ordered = oneLine(tableNames.join(" "));
  const expected = oneLine(REQUIRED_TABLES.join(" "));

  process.stdout.write("  11-table list check:\n");
  const expectedSet = new Set(REQUIRED_TABLES);
  const seenSet = new Set(tableNames);
  const duplicated = tableNames.filter(
    (name, index) => tableNames.indexOf(name) !== index,
  );

  if (tableNames.length !== 11 || ordered !== expected) {
    problems.push({
      message: `expected exactly 11 tables in documented order; found ${tableNames.length}: ${tableNames.join(", ") || "(none)"}`,
    });
  }
  for (const name of REQUIRED_TABLES) {
    if (!seenSet.has(name)) {
      problems.push({ message: `missing table: ${name}` });
    }
  }
  for (const name of tableNames) {
    if (!expectedSet.has(name)) {
      problems.push({ message: `unexpected table: ${name}` });
    }
  }
  if (duplicated.length > 0) {
    problems.push({
      message: `duplicate CREATE TABLE: ${[...new Set(duplicated)].join(", ")}`,
    });
  }

  for (const name of REQUIRED_TABLES) {
    const block = extractTableBlock(sql, name);
    if (!block) {
      process.stdout.write(`    ${name}: MISSING DEFINITION\n`);
      continue;
    }
    const strict = /\)\s*STRICT\s*;/m.test(block);
    if (!strict) {
      problems.push({ message: `table ${name} is not declared STRICT` });
      process.stdout.write(`    ${name}: NOT STRICT\n`);
    } else {
      process.stdout.write(`    ${name}: STRICT OK\n`);
    }
    verifyColumnChecks(name, block, problems);
  }

  verifyKeyConstraints(sql, problems);
}

/** Per-table `*_json` / `*_at_ms` CHECK assertions. */
function verifyColumnChecks(
  tableName: string,
  block: string,
  problems: Problem[],
): void {
  for (const column of extractColumnNames(block)) {
    if (column.endsWith("_json")) {
      const ok = new RegExp(
        `\\b${column}\\b[\\s\\S]*?\\bCHECK\\s*\\([^)]*json_valid\\s*\\(`,
      ).test(block);
      if (!ok) {
        problems.push({
          message: `table ${tableName} column ${column} lacks a json_valid(...) CHECK`,
        });
      }
    }
    if (column.endsWith("_at_ms")) {
      const ok = new RegExp(
        `\\b${column}\\b[\\s\\S]*?\\bCHECK\\s*\\([^)]*>= 0\\)`,
      ).test(block);
      if (!ok) {
        problems.push({
          message: `table ${tableName} column ${column} lacks a non-negative CHECK`,
        });
      }
    }
  }
}

/** Key partial-unique / PK / FK / UNIQUE / index assertions for 0001. */
function verifyKeyConstraints(sql: string, problems: Problem[]): void {
  const flat = oneLine(sql);

  function expect(regex: RegExp, label: string): void {
    if (!regex.test(flat)) {
      problems.push({ message: `missing or malformed constraint: ${label}` });
    } else {
      process.stdout.write(`  constraint OK: ${label}\n`);
    }
  }

  expect(
    /CREATE UNIQUE INDEX idx_model_profiles_single_active ON model_profiles \(is_active\) WHERE is_active = 1/,
    "model_profiles partial unique index WHERE is_active = 1",
  );
  expect(
    /ai_daily_usage[^;]*PRIMARY KEY \(date_key, capability, profile_key\)/,
    "ai_daily_usage PRIMARY KEY (date_key, capability, profile_key)",
  );
  expect(
    /CREATE UNIQUE INDEX idx_data_migration_runs_idempotency ON data_migration_runs \(source_kind, source_path_hash, source_fingerprint\)/,
    "data_migration_runs three-column unique index",
  );
  // The seven-column UNIQUE spans multiple lines and sits after a REFERENCES
  // column, so it is matched with a tolerant, whitespace-insensitive pattern
  // against the raw (non-squashed) SQL: table name → UNIQUE ( … prompt_version ).
  expect(
    /insight_enhancement_cache[\s\S]*?UNIQUE\s*\(\s*surface_id\s*,\s*scope_hash\s*,\s*evidence_hash\s*,\s*locale\s*,\s*profile_id\s*,\s*prompt_version_id\s*,\s*prompt_version\s*\)/,
    "insight_enhancement_cache seven-column UNIQUE",
  );
  expect(
    /CREATE INDEX idx_insight_enhancement_cache_surface_expires ON insight_enhancement_cache \(surface_id, expires_at_ms\)/,
    "insight_enhancement_cache (surface_id, expires_at_ms) index",
  );
  expect(
    /insight_enhancement_lines[^;]*PRIMARY KEY \(cache_key, sequence\)/,
    "insight_enhancement_lines PRIMARY KEY (cache_key, sequence)",
  );
  expect(
    /insight_enhancement_lines[^;]*cache_key TEXT NOT NULL REFERENCES insight_enhancement_cache \(cache_key\) ON DELETE CASCADE/,
    "insight_enhancement_lines cache_key ON DELETE CASCADE",
  );
}

function main(): void {
  const argv = process.argv.slice(2);
  const sqlDir = parseSqlDir(argv);
  const problems: Problem[] = [];

  process.stdout.write(`verify-database-schema: ${sqlDir}\n`);

  const migrations = listMigrations(sqlDir, problems);
  const indexPath = join(sqlDir, "index.ts");
  let indexTsSource = "";
  try {
    indexTsSource = readFileSync(indexPath, "utf8");
  } catch {
    problems.push({
      message: `cannot read migrations/index.ts (dual-source comparison skipped): ${indexPath}`,
    });
  }

  const sqlByVersion = new Map<number, string>();
  for (const file of migrations) {
    process.stdout.write(
      `migration ${String(file.version).padStart(4, "0")} ${file.name}:\n`,
    );
    const sql = verifyDualSource(file, indexTsSource, problems);
    if (sql !== undefined) sqlByVersion.set(file.version, sql);
  }

  if (sqlByVersion.has(1)) {
    verifyPlatform0001(sqlByVersion.get(1)!, problems);
  } else if (migrations.some((file) => file.version === 1)) {
    problems.push({
      message: "migration 0001 present but unreadable; skipped 11-table check",
    });
  }

  if (problems.length > 0) {
    process.stderr.write("\nverify-database-schema: FAIL\n");
    for (const problem of problems) {
      process.stderr.write(`  - ${problem.message}\n`);
    }
    process.exitCode = 1;
    return;
  }
  process.stdout.write("\nverify-database-schema: OK\n");
}

main();
