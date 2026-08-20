// Seed a throwaway AITracker home with a STALE usage + skills snapshot in
// SQLite, so the stale-snapshot e2e scenarios (performance-stale-offline.spec.ts)
// reproduce "stale last-known-good + offline" without scanning the real machine.
//
// Usage: node scripts/e2e/seed-stale-home.mjs <targetHomeDir> [--now-ms <epochMs>]
//
// Produces <targetHomeDir>/.trusttools/data/trusttools.v1.db by:
//   1. running the real migrations 0 -> 5 (read from the reviewable .sql files)
//      with a fixed clock, so the database is byte-schema-identical to a fresh
//      app install and its schema_migrations ledger checksums match what the
//      migration runner computes;
//   2. inserting one snapshot_generations + one snapshot_heads row each for the
//      `usage` and `skills` domains, whose generated_at_ms is far in the past so
//      SnapshotCoordinator.readLatest() reports `stale` (age > freshForMs) while
//      still serving the last-known-good data (an empty but non-null projection).
//
// Deterministic by default: `--now-ms` defaults to a fixed 2026-08-20 epoch so
// the same inputs always produce the same ledger/applied timestamps.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(
  SCRIPT_DIR,
  "..",
  "..",
  "src",
  "platform",
  "database",
  "migrations",
);

const APP_VERSION = "3.0.1"; // keep in sync with src/lib/app-config.ts
const DEFAULT_NOW_MS = Date.UTC(2026, 7, 20, 0, 0, 0);
const STALE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, matching the old fixture

const MIGRATIONS = [
  "0001_platform",
  "0002_low_risk_state",
  "0003_snapshot_read_models",
  "0004_business_assets",
  "0005_search_wsl",
];

const USAGE =
  "usage: node scripts/e2e/seed-stale-home.mjs <targetHomeDir> [--now-ms <epochMs>]";

function parseArgs(argv) {
  let nowMs = DEFAULT_NOW_MS;
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--now-ms") {
      const value = argv[i + 1];
      if (value === undefined || !/^\d+$/.test(value)) {
        throw new Error(
          `--now-ms requires a non-negative integer (got: ${value})`,
        );
      }
      nowMs = Number(value);
      i += 1;
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`unknown option: ${arg}`);
    positionals.push(arg);
  }
  if (positionals.length !== 1) throw new Error(USAGE);
  return { targetDir: positionals[0], nowMs };
}

/** BOM-strip + CRLF->LF, the same canonical form as migration-runner.server.ts. */
function normalizeSql(sql) {
  return sql.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}

/**
 * Reconstruct the SQL the migration runner actually EXECUTES. The inline
 * migration SQL is stored as JS template literals whose source text is
 * byte-identical to the reviewable `.sql` files (verified by
 * scripts/verify-database-schema.mts). Evaluating a template literal applies JS
 * escape processing, and the only escape present in these migrations is `\\` →
 * `\` (0003's agent_installation_paths CHECK rejects backslash-prefixed absolute
 * paths). Collapse it so the executed text — and therefore its SHA-256 ledger
 * checksum — matches exactly what `runMigrations` computes.
 */
function executedSql(rawSql) {
  return normalizeSql(rawSql).replace(/\\\\/g, "\\");
}

function checksum(sql) {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

function runMigrations(database, nowMs) {
  for (const name of MIGRATIONS) {
    const raw = readFileSync(join(MIGRATIONS_DIR, `${name}.sql`), "utf8");
    const sql = executedSql(raw);
    database.exec(sql);
    const version = Number(name.slice(0, 4));
    database
      .prepare(
        `INSERT INTO schema_migrations
           (version, name, checksum, app_version, applied_at_ms, duration_ms)
         VALUES (?, ?, ?, ?, ?, 0)`,
      )
      .run(version, name, checksum(sql), APP_VERSION, nowMs);
    database.exec(`PRAGMA user_version = ${version}`);
  }
}

function seedStaleSnapshot(database, domain, nowMs) {
  const generatedAtMs = nowMs - STALE_AGE_MS;
  const snapshotId = `seed-${domain}-stale`;
  const revision = `seed-${domain}-stale-v1`;
  database
    .prepare(
      `INSERT INTO snapshot_generations
         (snapshot_id, domain, schema_version, revision, generated_at_ms,
          source_fingerprint, status, last_attempt_at_ms, last_success_at_ms,
          duration_ms, scanned_items, reused_items, created_at_ms)
       VALUES (?, ?, 1, ?, ?, NULL, 'fresh', ?, ?, NULL, NULL, NULL, ?)`,
    )
    .run(
      snapshotId,
      domain,
      revision,
      generatedAtMs,
      generatedAtMs,
      generatedAtMs,
      generatedAtMs,
    );
  database
    .prepare(
      `INSERT INTO snapshot_heads (domain, snapshot_id, updated_at_ms)
       VALUES (?, ?, ?)`,
    )
    .run(domain, snapshotId, generatedAtMs);
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`seed-stale-home: ${error.message}\n`);
    process.exitCode = 1;
    return;
  }

  const dataDir = join(args.targetDir, ".trusttools", "data");
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "trusttools.v1.db");

  const database = new DatabaseSync(dbPath);
  try {
    runMigrations(database, args.nowMs);
    seedStaleSnapshot(database, "usage", args.nowMs);
    seedStaleSnapshot(database, "skills", args.nowMs);
  } finally {
    database.close();
  }

  process.stdout.write(
    `seed-stale-home: seeded ${dbPath} (usage + skills stale @ ${args.nowMs - STALE_AGE_MS})\n`,
  );
}

main();
