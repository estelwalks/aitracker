// Static verification gate for the platform database migrations
// (Story S-04, T-04-01; hardened in review batch B, finding P1-9).
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
//   3. The `MIGRATIONS` array actually references those inline constants
//      (`version:`/`name:`/`sql:` triple), so an inlined-but-unreferenced
//      migration cannot pass.
//   4. Migration 0001 defines exactly the 11 first-wave STRICT tables with the
//      documented names, and its key constraints/indexes are present.
//   5. Every `*_json` column has a `json_valid(...)` CHECK and every
//      `*_at_ms` column has a non-negative CHECK — matched **inside that
//      column's own slice**, so a later column's CHECK can no longer satisfy an
//      earlier column (the review's cross-column false negative).
//   6. The set of top-level statements is closed: only `CREATE TABLE` for the
//      11 documented tables, whitelisted `CREATE [UNIQUE] INDEX`, and
//      `PRAGMA application_id`/`user_version` stamping are allowed. A
//      `CREATE TRIGGER`/`VIEW`/`VIRTUAL TABLE`, `INSERT`, `ATTACH`, `DELETE`,
//      `UPDATE`, … is a FAIL.
//   7. `PRAGMA application_id`, when present, carries a plausible non-zero
//      constant (WARN-only while batch C has not stamped it yet).
//
// ANALYSIS RUNS ON COMMENT-STRIPPED SQL: `--` line comments and `/* */` block
// comments are blanked out (preserving offsets and newlines) before any
// structural assertion, so "delete the constraint and hide it in a comment"
// cannot go green. The stripper is string-literal aware (`'…''…'` and `"…"`),
// which migration 0001 does not need today but a future migration will.
//
// Exit code 0 means OK; 1 means a FAIL was reported. Warnings never fail.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
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

/** The only indexes migration 0001 may create. */
const ALLOWED_INDEXES = [
  "idx_data_migration_runs_idempotency",
  "idx_model_profiles_single_active",
  "idx_ai_executions_capability_started",
  "idx_ai_executions_profile_started",
  "idx_ai_executions_status_started",
  "idx_insight_enhancement_cache_surface_expires",
];

/** Columns whose own slice must declare a value-domain (`… IN (…)`) CHECK. */
const REQUIRED_ENUM_CHECKS: readonly (readonly [string, string])[] = [
  ["data_migration_runs", "source_kind"],
  ["data_migration_runs", "status"],
  ["app_preferences", "value_type"],
  ["secure_secrets", "purpose"],
  ["secure_secrets", "encryption_kind"],
  ["model_profiles", "mode"],
  ["model_profiles", "protocol"],
  ["model_profiles", "is_active"],
  ["ai_executions", "capability"],
  ["ai_executions", "status"],
  ["ai_executions", "used_fallback"],
  ["ai_executions", "cost_confidence"],
  ["insight_preferences", "mode"],
  ["insight_enhancement_cache", "status"],
];

/** Columns that must stay NOT NULL (nullability is a data-integrity change). */
const REQUIRED_NOT_NULL: readonly (readonly [string, string])[] = [
  ["schema_migrations", "name"],
  ["schema_migrations", "checksum"],
  ["schema_migrations", "app_version"],
  ["app_preferences", "value_json"],
  ["runtime_flags", "value_json"],
  ["secure_secrets", "ciphertext"],
  ["model_profiles", "name"],
  ["model_profiles", "is_active"],
  ["ai_executions", "capability"],
  ["ai_executions", "prompt_version_id"],
  ["insight_enhancement_cache", "surface_id"],
  ["insight_enhancement_cache", "scope_hash"],
  ["insight_enhancement_cache", "evidence_hash"],
  ["insight_enhancement_cache", "locale"],
  ["insight_enhancement_lines", "cache_key"],
  ["insight_enhancement_lines", "sequence"],
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

/** One top-level `…;` statement of a migration, comment-stripped. */
interface Statement {
  readonly text: string;
  /** 1-based line where the statement starts, for actionable FAIL messages. */
  readonly line: number;
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
 * Blanks out `--` line comments and `/* … *\/` block comments, keeping the
 * character count and every newline so offsets and line numbers stay valid.
 * String literals (`'…'`, with `''` escape) and quoted identifiers (`"…"`) are
 * copied verbatim, so a `--` inside a literal is NOT treated as a comment.
 */
function stripSqlComments(sql: string): string {
  type Mode = "code" | "line" | "block" | "single" | "double";
  let mode: Mode = "code";
  let out = "";
  let index = 0;
  while (index < sql.length) {
    const char = sql[index];
    const next = index + 1 < sql.length ? sql[index + 1] : "";
    if (mode === "code") {
      if (char === "-" && next === "-") {
        mode = "line";
        out += "  ";
        index += 2;
        continue;
      }
      if (char === "/" && next === "*") {
        mode = "block";
        out += "  ";
        index += 2;
        continue;
      }
      if (char === "'") mode = "single";
      else if (char === '"') mode = "double";
      out += char;
      index += 1;
      continue;
    }
    if (mode === "line") {
      if (char === "\n") {
        mode = "code";
        out += char;
      } else {
        out += " ";
      }
      index += 1;
      continue;
    }
    if (mode === "block") {
      if (char === "*" && next === "/") {
        mode = "code";
        out += "  ";
        index += 2;
        continue;
      }
      out += char === "\n" ? "\n" : " ";
      index += 1;
      continue;
    }
    // Inside a string literal / quoted identifier.
    const quote = mode === "single" ? "'" : '"';
    if (char === quote && next === quote) {
      out += char + next;
      index += 2;
      continue;
    }
    if (char === quote) mode = "code";
    out += char;
    index += 1;
  }
  return out;
}

/**
 * Splits comment-stripped SQL into top-level `;`-terminated statements,
 * ignoring semicolons inside parentheses or string literals.
 */
function splitTopLevelStatements(sql: string): Statement[] {
  const statements: Statement[] = [];
  let depth = 0;
  let quote: "'" | '"' | undefined;
  let start = 0;
  let line = 1;
  let startLine = 1;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    if (char === "\n") line += 1;
    if (quote !== undefined) {
      if (char === quote) {
        if (sql[index + 1] === quote) index += 1;
        else quote = undefined;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === ";" && depth === 0) {
      const text = sql.slice(start, index + 1);
      if (text.trim() !== "") statements.push({ text, line: startLine });
      start = index + 1;
      startLine = line;
      continue;
    }
    if (sql.slice(start, index + 1).trim() === "") startLine = line;
  }
  const tail = sql.slice(start);
  if (tail.trim() !== "") statements.push({ text: tail, line: startLine });
  return statements;
}

/** Splits a `CREATE TABLE` body into its top-level column/constraint items. */
function splitTopLevelItems(body: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let quote: "'" | '"' | undefined;
  let start = 0;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote !== undefined) {
      if (char === quote) {
        if (body[index + 1] === quote) index += 1;
        else quote = undefined;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === "," && depth === 0) {
      items.push(body.slice(start, index));
      start = index + 1;
    }
  }
  items.push(body.slice(start));
  return items.map((item) => item.trim()).filter((item) => item !== "");
}

/** Table-level constraint keywords that start an item but not a column. */
const CONSTRAINT_KEYWORDS = new Set([
  "primary",
  "unique",
  "check",
  "foreign",
  "constraint",
]);

interface ColumnSlice {
  readonly name: string;
  /** The column's own definition text — nothing from any other column. */
  readonly text: string;
}

/** Column definitions of a table body, each paired with only its own text. */
function extractColumnSlices(body: string): ColumnSlice[] {
  const slices: ColumnSlice[] = [];
  for (const item of splitTopLevelItems(body)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s+/.exec(item);
    if (!match) continue;
    if (CONSTRAINT_KEYWORDS.has(match[1].toLowerCase())) continue;
    slices.push({ name: match[1], text: item });
  }
  return slices;
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

/** Parses `--sql-dir <path>` from argv; any other flag is a usage error. */
function parseSqlDir(argv: string[]): string {
  let sqlDir = DEFAULT_SQL_DIR;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--sql-dir") {
      const value = argv[i + 1];
      if (typeof value !== "string" || value === "" || value.startsWith("--")) {
        throw new Error("--sql-dir requires a directory path argument");
      }
      sqlDir = value;
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${argv[i]}`);
  }
  return sqlDir;
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

/**
 * The inline constant must actually be wired into the ordered `MIGRATIONS`
 * array; otherwise a reviewed `.sql` file and its inline twin can both look
 * perfect while the runner applies something else (review finding P1-9).
 */
function verifyMigrationRegistration(
  file: MigrationFile,
  indexTsSource: string,
  problems: Problem[],
): void {
  const flat = oneLine(indexTsSource);
  const expectations: readonly (readonly [RegExp, string])[] = [
    [new RegExp(`version:\\s*${file.version}\\b`), `version: ${file.version}`],
    [new RegExp(`name:\\s*"${file.name}"`), `name: "${file.name}"`],
    [
      new RegExp(`sql:\\s*PLATFORM_MIGRATION_${file.prefix}_SQL\\b`),
      `sql: PLATFORM_MIGRATION_${file.prefix}_SQL`,
    ],
  ];
  const missing = expectations
    .filter(([pattern]) => !pattern.test(flat))
    .map(([, label]) => label);
  if (missing.length > 0) {
    problems.push({
      message: `MIGRATIONS does not reference ${file.name} (missing ${missing.join(", ")})`,
    });
  } else {
    process.stdout.write(`  ${file.name}: MIGRATIONS registration OK\n`);
  }
}

interface TableDefinition {
  readonly name: string;
  /** Text inside the outermost parentheses. */
  readonly body: string;
  /** The whole `CREATE TABLE … ;` statement. */
  readonly text: string;
}

/**
 * Closed-set check over the top-level statements, plus the extracted
 * `CREATE TABLE` definitions used by every later assertion.
 */
function verifyTopLevelStatements(
  statements: readonly Statement[],
  problems: Problem[],
): { tables: TableDefinition[]; indexes: string[] } {
  const tables: TableDefinition[] = [];
  const indexes: string[] = [];
  const allowedTables = new Set(REQUIRED_TABLES);
  const allowedIndexes = new Set(ALLOWED_INDEXES);

  process.stdout.write("  top-level statement closed-set check:\n");
  for (const statement of statements) {
    const flat = oneLine(statement.text);
    const table = /^CREATE\s+TABLE\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/i.exec(flat);
    if (table !== null) {
      const name = table[1];
      if (!allowedTables.has(name)) {
        problems.push({
          message: `line ${statement.line}: CREATE TABLE of an undocumented table: ${name}`,
        });
      }
      const body = extractParenthesizedBody(statement.text);
      if (body === undefined) {
        problems.push({
          message: `line ${statement.line}: unbalanced parentheses in CREATE TABLE ${name}`,
        });
        continue;
      }
      tables.push({ name, body, text: statement.text });
      continue;
    }
    const index =
      /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+([A-Za-z_][A-Za-z0-9_]*)\s+ON\s+/i.exec(
        flat,
      );
    if (index !== null) {
      if (!allowedIndexes.has(index[1])) {
        problems.push({
          message: `line ${statement.line}: index not on the whitelist: ${index[1]}`,
        });
      }
      indexes.push(index[1]);
      continue;
    }
    // Stamping pragmas are the only non-DDL statements a migration may carry.
    if (
      /^PRAGMA\s+(?:application_id|user_version)\s*=\s*-?\d+\s*;?$/i.test(flat)
    ) {
      continue;
    }
    problems.push({
      message: `line ${statement.line}: forbidden top-level statement: ${flat.slice(0, 60)}`,
    });
  }
  process.stdout.write(
    `    ${statements.length} statements, ${tables.length} CREATE TABLE, ${indexes.length} CREATE INDEX\n`,
  );
  return { tables, indexes };
}

/** Text between the first `(` and its matching `)`. */
function extractParenthesizedBody(statement: string): string | undefined {
  const openIndex = statement.indexOf("(");
  if (openIndex < 0) return undefined;
  let depth = 0;
  let quote: "'" | '"' | undefined;
  for (let index = openIndex; index < statement.length; index += 1) {
    const char = statement[index];
    if (quote !== undefined) {
      if (char === quote) {
        if (statement[index + 1] === quote) index += 1;
        else quote = undefined;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return statement.slice(openIndex + 1, index);
    }
  }
  return undefined;
}

/** Verifies 0001's 11-table list + STRICT + per-column and key constraints. */
function verifyPlatform0001(
  sql: string,
  problems: Problem[],
  warnings: string[],
): void {
  const stripped = stripSqlComments(sql);
  const statements = splitTopLevelStatements(stripped);
  const { tables } = verifyTopLevelStatements(statements, problems);

  const tableNames = tables.map((table) => table.name);
  const ordered = oneLine(tableNames.join(" "));
  const expected = oneLine(REQUIRED_TABLES.join(" "));

  process.stdout.write("  11-table list check:\n");
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
  if (duplicated.length > 0) {
    problems.push({
      message: `duplicate CREATE TABLE: ${[...new Set(duplicated)].join(", ")}`,
    });
  }

  const byName = new Map(tables.map((table) => [table.name, table]));
  for (const name of REQUIRED_TABLES) {
    const table = byName.get(name);
    if (table === undefined) {
      process.stdout.write(`    ${name}: MISSING DEFINITION\n`);
      continue;
    }
    if (!/\)\s*STRICT\s*;?\s*$/m.test(table.text.trim())) {
      problems.push({ message: `table ${name} is not declared STRICT` });
      process.stdout.write(`    ${name}: NOT STRICT\n`);
    } else {
      process.stdout.write(`    ${name}: STRICT OK\n`);
    }
    verifyColumnChecks(table, problems);
  }

  verifyDocumentedColumnRules(byName, problems);
  verifyKeyConstraints(stripped, problems);
  verifyApplicationId(stripped, warnings, problems);
}

/**
 * Per-column `*_json` / `*_at_ms` CHECK assertions.
 *
 * The match is scoped to the column's OWN slice. The previous implementation
 * searched the whole table block from the column name onwards, so any later
 * column's `CHECK (… >= 0)` satisfied an earlier column that had none — the
 * false negative reported as P1-9.
 */
function verifyColumnChecks(table: TableDefinition, problems: Problem[]): void {
  for (const column of extractColumnSlices(table.body)) {
    if (column.name.endsWith("_json")) {
      const ok = /\bCHECK\s*\([\s\S]*json_valid\s*\(/i.test(column.text);
      if (!ok) {
        problems.push({
          message: `table ${table.name} column ${column.name} lacks a json_valid(...) CHECK`,
        });
      }
    }
    if (column.name.endsWith("_at_ms")) {
      // Accept `>= 0` and `>=0`; the CHECK may be wrapped in an IS NULL OR form.
      const ok = /\bCHECK\s*\([\s\S]*>=\s*0/i.test(column.text);
      if (!ok) {
        problems.push({
          message: `table ${table.name} column ${column.name} lacks a non-negative CHECK`,
        });
      }
    }
  }
}

/** Documented enum-domain and NOT NULL expectations, per column slice. */
function verifyDocumentedColumnRules(
  tables: ReadonlyMap<string, TableDefinition>,
  problems: Problem[],
): void {
  const slices = new Map<string, string>();
  for (const [name, table] of tables) {
    for (const column of extractColumnSlices(table.body)) {
      slices.set(`${name}.${column.name}`, column.text);
    }
  }

  let enumOk = 0;
  for (const [table, column] of REQUIRED_ENUM_CHECKS) {
    const slice = slices.get(`${table}.${column}`);
    if (slice === undefined) {
      problems.push({ message: `missing column ${table}.${column}` });
      continue;
    }
    if (!/\bCHECK\s*\([\s\S]*\bIN\s*\(/i.test(slice)) {
      problems.push({
        message: `column ${table}.${column} lacks a value-domain CHECK (... IN (...))`,
      });
      continue;
    }
    enumOk += 1;
  }

  let notNullOk = 0;
  for (const [table, column] of REQUIRED_NOT_NULL) {
    const slice = slices.get(`${table}.${column}`);
    if (slice === undefined) {
      problems.push({ message: `missing column ${table}.${column}` });
      continue;
    }
    if (!/\bNOT\s+NULL\b/i.test(slice)) {
      problems.push({
        message: `column ${table}.${column} must stay NOT NULL`,
      });
      continue;
    }
    notNullOk += 1;
  }
  process.stdout.write(
    `  column rules OK: ${enumOk}/${REQUIRED_ENUM_CHECKS.length} enum CHECK, ${notNullOk}/${REQUIRED_NOT_NULL.length} NOT NULL\n`,
  );
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
  // column, so it is matched with a tolerant, whitespace-insensitive pattern:
  // table name → UNIQUE ( … prompt_version ).
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

/**
 * `PRAGMA application_id` guard (architecture §9-6 database-substitution
 * protection). Batch B keeps this WARN-only because batch C (finding P1-4) is
 * the change that stamps it; once stamped, the value is asserted to be a
 * plausible non-zero 32-bit constant and — when `migrations/index.ts` exports a
 * central constant — to match it. Promote this warning to a FAIL after P1-4.
 */
function verifyApplicationId(
  sql: string,
  warnings: string[],
  problems: Problem[],
): void {
  const matches = [...sql.matchAll(/PRAGMA\s+application_id\s*=\s*(-?\d+)/gi)];
  if (matches.length === 0) {
    warnings.push(
      "no PRAGMA application_id in migration 0001 (§9-6 substitution guard) — expected from fix batch C / P1-4; WARN only for now",
    );
    return;
  }
  if (matches.length > 1) {
    problems.push({
      message: `PRAGMA application_id is set ${matches.length} times; exactly one stamping statement is allowed`,
    });
    return;
  }
  const value = Number(matches[0][1]);
  if (!Number.isSafeInteger(value) || value <= 0 || value > 0x7fffffff) {
    problems.push({
      message: `PRAGMA application_id must be a positive 32-bit constant; found ${matches[0][1]}`,
    });
    return;
  }
  process.stdout.write(`  application_id OK: ${value}\n`);
}

function main(): void {
  const argv = process.argv.slice(2);
  let sqlDir: string;
  try {
    sqlDir = parseSqlDir(argv);
  } catch (error) {
    process.stderr.write(
      `verify-database-schema: ${error instanceof Error ? error.message : "invalid arguments"}\n`,
    );
    process.stderr.write(
      "usage: node scripts/verify-database-schema.mts [--sql-dir <path>]\n",
    );
    process.exitCode = 1;
    return;
  }
  const problems: Problem[] = [];
  const warnings: string[] = [];

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
    if (indexTsSource !== "") {
      verifyMigrationRegistration(file, indexTsSource, problems);
    }
  }

  if (sqlByVersion.has(1)) {
    verifyPlatform0001(sqlByVersion.get(1)!, problems, warnings);
  } else if (migrations.some((file) => file.version === 1)) {
    problems.push({
      message: "migration 0001 present but unreadable; skipped 11-table check",
    });
  }

  for (const warning of warnings) {
    process.stdout.write(`  WARN: ${warning}\n`);
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
