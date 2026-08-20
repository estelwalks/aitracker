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
//   4. Migration 0001 defines exactly the 10 new-project STRICT tables with the
//      documented names, and its key constraints/indexes are present.
//   5. Every `*_json` column has a `json_valid(...)` CHECK and every
//      `*_at_ms` column has a non-negative CHECK — matched **inside that
//      column's own slice**, so a later column's CHECK can no longer satisfy an
//      earlier column (the review's cross-column false negative).
//   6. The set of top-level statements is closed: only `CREATE TABLE` for the
//      11 documented tables, whitelisted `CREATE [UNIQUE] INDEX`, and
//      `PRAGMA application_id` stamping are allowed. A `CREATE TRIGGER`/`VIEW`/
//      `VIRTUAL TABLE`, `INSERT`, `ATTACH`, `DELETE`, `UPDATE`, … is a FAIL.
//   7. `PRAGMA application_id` is present exactly once and equals the
//      TrustTools constant `0x54544442` (architecture §9-6; promoted to FAIL by
//      fix batch C / P1-4).
//   8. Migration 0001 does NOT stamp `PRAGMA user_version` itself: the version
//      is written and asserted by the migration runner inside each migration's
//      transaction, so a competing stamp in 0001 is a FAIL.
//   9. Data-domain checks: enum domains are `NOT NULL` (where documented), the
//      reconciliation/usage counters carry `>= 0` CHECKs, `date_key` carries a
//      `YYYY-MM-DD` GLOB, `model_profiles.name` is bounded, `ciphertext` has a
//      minimum length, `app_preferences.value_type` matches `json_type`, and
//      the `analysis` / `value_json` forbidden-content CHECKs are present.
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

const M2_TABLES = [
  "task_preferences",
  "task_runs",
  "monitoring_state",
  "monitoring_collectors",
  "http_cache_entries",
] as const;

const M2_INDEXES = [
  "idx_task_runs_task_started",
  "idx_task_runs_status_started",
  "idx_task_runs_correlation",
  "idx_http_cache_namespace_expires",
] as const;

const M5_TABLES = ["snapshot_blobs", "search_documents"] as const;

const M5_INDEXES = [
  "idx_search_documents_type_updated",
  "idx_search_documents_freshness",
] as const;

/** `PRAGMA application_id` migration 0001 must stamp (architecture §9-6). */
const TRUSTTOOLS_APPLICATION_ID_VALUE = 0x54544442;

/** The only indexes migration 0001 may create. */
const ALLOWED_INDEXES = [
  "idx_model_profiles_single_active",
  "idx_ai_executions_capability_started",
  "idx_ai_executions_profile_started",
  "idx_ai_executions_status_started",
  "idx_insight_enhancement_cache_surface_expires",
  "idx_insight_enhancement_cache_identity",
];

/** Columns whose own slice must declare a value-domain (`… IN (…)`) CHECK. */
const REQUIRED_ENUM_CHECKS: readonly (readonly [string, string])[] = [
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
  ["ai_daily_usage", "capability"],
  ["insight_preferences", "mode"],
  ["insight_enhancement_cache", "status"],
];

/** Columns that must stay NOT NULL (nullability is a data-integrity change). */
const REQUIRED_NOT_NULL: readonly (readonly [string, string])[] = [
  ["schema_migrations", "name"],
  ["schema_migrations", "checksum"],
  ["schema_migrations", "app_version"],
  ["app_preferences", "value_json"],
  ["app_preferences", "value_type"],
  ["runtime_flags", "value_json"],
  ["secure_secrets", "ciphertext"],
  ["secure_secrets", "purpose"],
  ["secure_secrets", "encryption_kind"],
  ["model_profiles", "name"],
  ["model_profiles", "mode"],
  ["model_profiles", "protocol"],
  ["model_profiles", "is_active"],
  ["ai_executions", "capability"],
  ["ai_executions", "status"],
  ["ai_executions", "used_fallback"],
  ["ai_executions", "prompt_version_id"],
  ["insight_enhancement_cache", "surface_id"],
  ["insight_enhancement_cache", "scope_hash"],
  ["insight_enhancement_cache", "evidence_hash"],
  ["insight_enhancement_cache", "locale"],
  ["insight_enhancement_cache", "status"],
  ["insight_enhancement_lines", "cache_key"],
  ["insight_enhancement_lines", "sequence"],
];

/** Counter columns that must declare a non-negative (`>= 0`) CHECK. */
const REQUIRED_NON_NEGATIVE_CHECKS: readonly (readonly [string, string])[] = [
  ["ai_daily_usage", "calls"],
  ["ai_daily_usage", "input_tokens"],
  ["ai_daily_usage", "output_tokens"],
  ["ai_daily_usage", "cost_microusd"],
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

  let inline = extractInlineSql(indexTsSource, file.prefix);
  let inlineOwner = "migrations/index.ts";
  if (inline === undefined) {
    const sidecarPath = file.path.replace(/\.sql$/, ".ts");
    try {
      inline = extractInlineSql(readFileSync(sidecarPath, "utf8"), file.prefix);
      inlineOwner = relative(process.cwd(), sidecarPath);
    } catch {
      // A sidecar is optional; the diagnostic below remains authoritative.
    }
  }
  if (inline === undefined) {
    problems.push({
      message: `no inline PLATFORM_MIGRATION_${file.prefix}_SQL in migrations/index.ts or a same-name .ts sidecar`,
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
      `  ${file.name}: dual-source OK via ${inlineOwner} (sha256 ${fileHash})\n`,
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
      /^PRAGMA\s+application_id\s*=\s*-?(?:\d+|0x[0-9a-fA-F]+)\s*;?$/i.test(
        flat,
      )
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

/** Verifies 0001's closed table list + STRICT + column/key constraints. */
function verifyPlatform0001(sql: string, problems: Problem[]): void {
  const stripped = stripSqlComments(sql);
  const statements = splitTopLevelStatements(stripped);
  const { tables } = verifyTopLevelStatements(statements, problems);

  const tableNames = tables.map((table) => table.name);
  const ordered = oneLine(tableNames.join(" "));
  const expected = oneLine(REQUIRED_TABLES.join(" "));

  process.stdout.write(`  ${REQUIRED_TABLES.length}-table list check:\n`);
  const seenSet = new Set(tableNames);
  const duplicated = tableNames.filter(
    (name, index) => tableNames.indexOf(name) !== index,
  );

  if (tableNames.length !== REQUIRED_TABLES.length || ordered !== expected) {
    problems.push({
      message: `expected exactly ${REQUIRED_TABLES.length} tables in documented order; found ${tableNames.length}: ${tableNames.join(", ") || "(none)"}`,
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
  verifyDataDomainChecks(byName, stripped, problems);
  verifyApplicationId(stripped, problems);
  verifyUserVersionAbsent(stripped, problems);
}

/** Closed-set and core integrity gate for migration 0002 (M2 low-risk state). */
function verifyLowRisk0002(sql: string, problems: Problem[]): void {
  const stripped = stripSqlComments(sql);
  const statements = splitTopLevelStatements(stripped);
  const tables: TableDefinition[] = [];
  const indexes: string[] = [];
  for (const statement of statements) {
    const flat = oneLine(statement.text);
    const table = /^CREATE\s+TABLE\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/i.exec(flat);
    if (table) {
      const body = extractParenthesizedBody(statement.text);
      if (body === undefined) {
        problems.push({
          message: `0002 table ${table[1]} has unbalanced parentheses`,
        });
      } else {
        tables.push({ name: table[1], body, text: statement.text });
      }
      continue;
    }
    const index =
      /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+([A-Za-z_][A-Za-z0-9_]*)\s+ON\s+/i.exec(
        flat,
      );
    if (index) {
      indexes.push(index[1]);
      continue;
    }
    problems.push({
      message: `0002 forbidden top-level statement at line ${statement.line}`,
    });
  }
  if (tables.map((table) => table.name).join("\0") !== M2_TABLES.join("\0")) {
    problems.push({
      message: `0002 table set/order differs: ${tables.map((table) => table.name).join(", ")}`,
    });
  }
  if (indexes.join("\0") !== M2_INDEXES.join("\0")) {
    problems.push({
      message: `0002 index set/order differs: ${indexes.join(", ")}`,
    });
  }
  for (const table of tables) {
    if (!/\)\s*STRICT\s*;?\s*$/m.test(table.text.trim())) {
      problems.push({ message: `0002 table ${table.name} is not STRICT` });
    }
    verifyColumnChecks(table, problems);
  }
  const flat = oneLine(stripped);
  const expectations: readonly (readonly [RegExp, string])[] = [
    [
      /task_preferences[\s\S]*schedule_kind = 'interval'[\s\S]*interval_minutes IS NOT NULL/,
      "task preference schedule-kind shape CHECK",
    ],
    [
      /task_runs[\s\S]*status IN \('queued', 'running', 'waiting-approval', 'succeeded', 'failed', 'cancelled', 'skipped', 'abandoned'\)/,
      "task run status CHECK",
    ],
    [
      /monitoring_collectors[\s\S]*collector_id IN \('usage', 'skills', 'sessions', 'security', 'exchange', 'installation'\)/,
      "monitoring collector ID CHECK",
    ],
    [
      /http_cache_entries[\s\S]*PRIMARY KEY \(namespace, cache_key\)/,
      "HTTP cache composite key",
    ],
    [
      /http_cache_entries[\s\S]*expires_at_ms >= fetched_at_ms/,
      "HTTP cache TTL ordering CHECK",
    ],
  ];
  for (const [pattern, label] of expectations) {
    if (!pattern.test(flat))
      problems.push({ message: `0002 missing ${label}` });
  }
  process.stdout.write(
    `  0002 M2 schema: ${tables.length}/${M2_TABLES.length} STRICT tables, ${indexes.length}/${M2_INDEXES.length} indexes\n`,
  );
}

/**
 * Closed-set and core integrity gate for migration 0005 (S-03: snapshot blobs
 * for the WSL topology + the browser-safe search projection index).
 */
function verifySearchWsl0005(sql: string, problems: Problem[]): void {
  const stripped = stripSqlComments(sql);
  const statements = splitTopLevelStatements(stripped);
  const tables: TableDefinition[] = [];
  const indexes: string[] = [];
  for (const statement of statements) {
    const flat = oneLine(statement.text);
    const table = /^CREATE\s+TABLE\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/i.exec(flat);
    if (table) {
      const body = extractParenthesizedBody(statement.text);
      if (body === undefined) {
        problems.push({
          message: `0005 table ${table[1]} has unbalanced parentheses`,
        });
      } else {
        tables.push({ name: table[1], body, text: statement.text });
      }
      continue;
    }
    const index =
      /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+([A-Za-z_][A-Za-z0-9_]*)\s+ON\s+/i.exec(
        flat,
      );
    if (index) {
      indexes.push(index[1]);
      continue;
    }
    problems.push({
      message: `0005 forbidden top-level statement at line ${statement.line}`,
    });
  }
  if (tables.map((table) => table.name).join("\0") !== M5_TABLES.join("\0")) {
    problems.push({
      message: `0005 table set/order differs: ${tables.map((table) => table.name).join(", ")}`,
    });
  }
  if (indexes.join("\0") !== M5_INDEXES.join("\0")) {
    problems.push({
      message: `0005 index set/order differs: ${indexes.join(", ")}`,
    });
  }
  for (const table of tables) {
    if (!/\)\s*STRICT\s*;?\s*$/m.test(table.text.trim())) {
      problems.push({ message: `0005 table ${table.name} is not STRICT` });
    }
    verifyColumnChecks(table, problems);
  }

  const flat = oneLine(stripped);
  const expectations: readonly (readonly [RegExp, string])[] = [
    [
      /snapshot_blobs[\s\S]*snapshot_id TEXT PRIMARY KEY REFERENCES snapshot_generations \(snapshot_id\) ON DELETE CASCADE/,
      "snapshot_blobs FK → snapshot_generations ON DELETE CASCADE",
    ],
    [
      /snapshot_blobs[\s\S]*payload_json TEXT NOT NULL CHECK \(json_valid\(payload_json\)\)/,
      "snapshot_blobs payload_json json_valid CHECK",
    ],
    [
      /snapshot_blobs[\s\S]*payload_bytes INTEGER NOT NULL CHECK \(payload_bytes >= 0\)/,
      "snapshot_blobs payload_bytes non-negative CHECK",
    ],
    [
      /search_documents[\s\S]*UNIQUE \(type, source_ref\)/,
      "search_documents UNIQUE (type, source_ref)",
    ],
    [
      /search_documents[\s\S]*type IN \('agent', 'skill', 'session', 'report', 'knowledge', 'finding'\)/,
      "search_documents type enum CHECK",
    ],
    [
      /search_documents[\s\S]*freshness IN \('fresh', 'stale', 'unknown'\)/,
      "search_documents freshness enum CHECK",
    ],
    [
      /CREATE INDEX idx_search_documents_type_updated ON search_documents \(type, updated_at_ms DESC\)/,
      "search_documents (type, updated_at_ms DESC) index",
    ],
    [
      /CREATE INDEX idx_search_documents_freshness ON search_documents \(freshness\)/,
      "search_documents (freshness) index",
    ],
  ];
  for (const [pattern, label] of expectations) {
    if (!pattern.test(flat))
      problems.push({ message: `0005 missing ${label}` });
  }
  process.stdout.write(
    `  0005 search/wsl schema: ${tables.length}/${M5_TABLES.length} STRICT tables, ${indexes.length}/${M5_INDEXES.length} indexes\n`,
  );
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
  // The seven-column UNIQUE was replaced by an expression unique index (review
  // P2-2): SQLite treats NULLs as distinct, so a multi-column UNIQUE let two
  // NULL-profile/NULL-prompt rows coexist. The index collapses NULLs to
  // sentinels so the cache identity stays unique without a configured model.
  expect(
    /CREATE UNIQUE INDEX idx_insight_enhancement_cache_identity ON insight_enhancement_cache[\s\S]*COALESCE\(profile_id, ''\)[\s\S]*COALESCE\(prompt_version_id, ''\)[\s\S]*COALESCE\(prompt_version, 0\)/,
    "insight_enhancement_cache expression unique index (COALESCE identity)",
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
 * Data-domain checks added by review batch C (P1-8 SQL / P2-1 / P2-3): minimum
 * ciphertext length, `date_key` format, bounded `model_profiles.name`,
 * `value_type`↔`json_type` consistency, and the `analysis`/`value_json`
 * forbidden-content CHECKs. Each is a distinctive-substring assertion over the
 * comment-stripped SQL.
 */
function verifyDataDomainChecks(
  tables: ReadonlyMap<string, TableDefinition>,
  sql: string,
  problems: Problem[],
): void {
  const slices = new Map<string, string>();
  for (const [name, table] of tables) {
    for (const column of extractColumnSlices(table.body)) {
      slices.set(`${name}.${column.name}`, column.text);
    }
  }

  let nonNegativeOk = 0;
  for (const [table, column] of REQUIRED_NON_NEGATIVE_CHECKS) {
    const slice = slices.get(`${table}.${column}`);
    if (slice === undefined) {
      problems.push({ message: `missing column ${table}.${column}` });
      continue;
    }
    if (!/\bCHECK\s*\([\s\S]*>=\s*0/i.test(slice)) {
      problems.push({
        message: `column ${table}.${column} lacks a non-negative CHECK (>= 0)`,
      });
      continue;
    }
    nonNegativeOk += 1;
  }
  process.stdout.write(
    `  non-negative counters OK: ${nonNegativeOk}/${REQUIRED_NON_NEGATIVE_CHECKS.length}\n`,
  );

  const flat = oneLine(sql);
  function expect(regex: RegExp, label: string): void {
    if (!regex.test(flat)) {
      problems.push({ message: `missing or malformed constraint: ${label}` });
    } else {
      process.stdout.write(`  constraint OK: ${label}\n`);
    }
  }

  expect(
    /ciphertext\s+BLOB\s+NOT\s+NULL\s+CHECK\s*\(\s*length\s*\(\s*ciphertext\s*\)\s*>=\s*16/,
    "secure_secrets.ciphertext length >= 16",
  );
  expect(
    /date_key\s+GLOB\s+'\s*\[0-9\]\[0-9\]\[0-9\]\[0-9\]-\s*\[0-9\]\[0-9\]-\s*\[0-9\]\[0-9\]\s*'/,
    "ai_daily_usage.date_key YYYY-MM-DD GLOB",
  );
  expect(
    /name\s+TEXT\s+NOT\s+NULL\s+CHECK\s*\(\s*length\s*\(\s*name\s*\)\s+BETWEEN\s+1\s+AND\s+64/,
    "model_profiles.name length 1..64 CHECK",
  );
  expect(
    /json_type\s*\(\s*value_json\s*\)/,
    "app_preferences value_type/json_type consistency CHECK",
  );
  expect(
    /analysis\s+NOT\s+GLOB\s+'\*\[0-9\]\*'/,
    "insight_enhancement_lines.analysis no-digit CHECK",
  );
  expect(
    /instr\s*\(\s*analysis\s*,\s*char\s*\(\s*92\s*\)\s*\)/,
    "insight_enhancement_lines.analysis no-backslash CHECK",
  );
  expect(
    /value_json\s+NOT\s+LIKE\s+'%Bearer\s+%'/,
    "app_preferences.value_json no-Bearer CHECK",
  );
  expect(
    /instr\s*\(\s*value_json\s*,\s*char\s*\(\s*92\s*\)\s*\)/,
    "app_preferences.value_json no-backslash CHECK",
  );
}

/**
 * `PRAGMA application_id` guard (architecture §9-6 database-substitution
 * protection, promoted to FAIL by fix batch C / P1-4): migration 0001 must
 * stamp the TrustTools constant `0x54544442` exactly once.
 */
function verifyApplicationId(sql: string, problems: Problem[]): void {
  const matches = [
    ...sql.matchAll(
      /PRAGMA\s+application_id\s*=\s*(-?(?:0x[0-9a-fA-F]+|\d+))/gi,
    ),
  ];
  if (matches.length === 0) {
    problems.push({
      message:
        "no PRAGMA application_id in migration 0001 (§9-6 substitution guard); exactly one stamp of 0x54544442 is required",
    });
    return;
  }
  if (matches.length > 1) {
    problems.push({
      message: `PRAGMA application_id is set ${matches.length} times; exactly one stamping statement is allowed`,
    });
    return;
  }
  const raw = matches[0][1];
  const value = raw.toLowerCase().startsWith("0x")
    ? Number.parseInt(raw, 16)
    : Number(raw);
  if (value !== TRUSTTOOLS_APPLICATION_ID_VALUE) {
    problems.push({
      message: `PRAGMA application_id must be 0x54544442 (${TRUSTTOOLS_APPLICATION_ID_VALUE}); found ${raw}`,
    });
    return;
  }
  process.stdout.write(
    `  application_id OK: ${raw} (${TRUSTTOOLS_APPLICATION_ID_VALUE})\n`,
  );
}

/**
 * `user_version` is owned by the migration runner, which writes and asserts it
 * inside each migration's transaction. Migration 0001 must not carry a
 * competing stamp; the runner behaviour itself is covered by unit tests.
 */
function verifyUserVersionAbsent(sql: string, problems: Problem[]): void {
  if (/PRAGMA\s+user_version\s*=/i.test(sql)) {
    problems.push({
      message:
        "migration 0001 must not stamp PRAGMA user_version; the migration runner manages it inside each migration transaction",
    });
  } else {
    process.stdout.write(
      "  constraint OK: 0001 leaves PRAGMA user_version to the migration runner\n",
    );
  }
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
    verifyPlatform0001(sqlByVersion.get(1)!, problems);
  } else if (migrations.some((file) => file.version === 1)) {
    problems.push({
      message: `migration 0001 present but unreadable; skipped ${REQUIRED_TABLES.length}-table check`,
    });
  }

  if (sqlByVersion.has(2)) {
    verifyLowRisk0002(sqlByVersion.get(2)!, problems);
  }

  if (sqlByVersion.has(5)) {
    verifySearchWsl0005(sqlByVersion.get(5)!, problems);
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
