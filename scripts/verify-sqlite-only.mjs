// SQLite-only persistence gate.
//
// AITracker is initialized as a new SQLite application. Production code may
// read external Agent logs/assets and may write logs, SQLite backup metadata,
// and user-requested exported/installed files, but application-owned state may
// not fall back to JSON/localStorage or retain migration/shadow-write paths.
import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx"];
const PRODUCTION_ROOTS = ["src", "electron"];

// These exclusions are intentionally structural and narrow. Runtime scanners,
// static registries, backup code, loggers, and user file-operation modules are
// still scanned; they pass because the rules target app-owned persistence, not
// generic filesystem I/O.
const EXCLUDED_PATHS = [
  /(?:^|\/)__fixtures__\//,
  /(?:^|\/)fixtures\//,
  /(?:^|\/)__baseline__\//,
  /\.test\.(?:[cm]?[jt]sx?)$/,
  /\.generated\.(?:[cm]?[jt]sx?)$/,
];

const APP_OWNED_FILES = [
  "trusttools-prefs.json",
  "preferences.v1.json",
  "runs.v1.json",
  "performance-rollout.v1.json",
  "usage-snapshot.v1.json",
  "usage-snapshot-envelope.v1.json",
  "project-classification-index.v1.json",
  "wsl-topology-snapshot-envelope.v1.json",
  "session-snapshot-envelope.v1.json",
  "skill-snapshot-envelope.v1.json",
  "installation-snapshot-envelope.v1.json",
  "monitoring.v1.json",
  "reports.v1.json",
  "knowledge.v1.json",
  "distill-candidates.v1.json",
  "distill-quota.v1.json",
  "model-profiles.v1.json",
  "security-scan-history.json",
  "security-scan-schedule.json",
  "market-v1.json",
  "usd-rates.json",
  "local-usage-index-v1.json",
  "local-usage-index-v2.json",
  "local-usage-index-v3.json",
  "local-usage-index-v4.json",
  "local-usage-index-v5.json",
  "local-usage-index-v6.json",
  "local-usage-index-v7.json",
  "local-usage-index-v8.json",
  "local-usage-index-v9.json",
  "local-usage-index-v10.json",
  "skill-origins.json",
  "skill-blacklist.json",
];

const CONTENT_RULES = [
  {
    type: "atomic-json-store",
    pattern: /\b(?:NodeAtomicJsonStore|AtomicJsonStore)\b/g,
  },
  {
    type: "electron-file-store",
    pattern: /\bElectronStore\b|["']electron-store["']/g,
  },
  {
    type: "storage-shadow-or-double-write",
    pattern:
      /\b(?:createShadow[A-Za-z0-9_]*|ShadowAtomicJsonStore|ShadowRepositoryOptions|legacyStore)\b/g,
  },
  {
    type: "legacy-data-import",
    pattern:
      /\b(?:importAtomicJsonStore|importLegacy[A-Za-z]*|data_migration_runs)\b/g,
  },
  {
    type: "legacy-read-fallback",
    pattern:
      /\b(?:create[A-Za-z]*ReadFallback|withLegacy[A-Za-z]*|LegacyPreferenceSource|legacy\.read|readLegacy|legacyRead)\b/g,
  },
  {
    type: "legacy-read-switch",
    pattern:
      /\b(?:FORCE_LEGACY_READ_PATH|TRUSTTOOLS_FORCE_LEGACY_READ_PATH|forceLegacyReadPath|readFromSqlite)\b/g,
  },
  {
    type: "app-owned-local-storage",
    pattern: /\blocalStorage\b/g,
  },
  {
    type: "app-owned-json-file",
    pattern: new RegExp(APP_OWNED_FILES.map(escapeRegExp).join("|"), "g"),
  },
  {
    type: "app-owned-sidecar-state",
    pattern: /["'`](?:schema_version|security-dev-api-key)["'`]/g,
  },
];

const FORBIDDEN_FILE_PATHS = [
  /(?:^|\/)legacy-import\.server\.[cm]?[jt]s$/,
  /(?:^|\/)m2-legacy-imports\.server\.[cm]?[jt]s$/,
  /(?:^|\/)shadow-[^/]+\.[cm]?[jt]sx?$/,
  /(?:^|\/)storage-cutover\.server\.[cm]?[jt]s$/,
  /(?:^|\/)data-migration\.contracts\.[cm]?[jt]s$/,
  /(?:^|\/)node-atomic-json-store\.[cm]?[jt]s$/,
  /atomic-[^/]+-store\.[cm]?[jt]s$/,
  /(?:^|\/)node-file-(?:system|lock)\.[cm]?[jt]s$/,
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function repoPath(file, rootDir) {
  return relative(rootDir, file).split(sep).join("/");
}

function isSourceFile(name) {
  return SOURCE_EXTENSIONS.some((extension) => name.endsWith(extension));
}

function isExcluded(path) {
  return EXCLUDED_PATHS.some((pattern) => pattern.test(path));
}

async function listSourceFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return listSourceFiles(path);
      return entry.isFile() && isSourceFile(entry.name) ? [path] : [];
    }),
  );
  return nested.flat();
}

function lineNumber(source, index) {
  return source.slice(0, index).split("\n").length;
}

export async function analyzeSqliteOnly(rootDir = root) {
  const files = (
    await Promise.all(
      PRODUCTION_ROOTS.map((directory) =>
        listSourceFiles(resolve(rootDir, directory)),
      ),
    )
  )
    .flat()
    .sort();
  const violations = [];

  for (const file of files) {
    const path = repoPath(file, rootDir);
    if (isExcluded(path)) continue;

    for (const pattern of FORBIDDEN_FILE_PATHS) {
      if (pattern.test(path)) {
        violations.push({
          type: "forbidden-storage-module",
          file: path,
          line: 1,
          detail: path.split("/").at(-1),
        });
        break;
      }
    }

    const source = await readFile(file, "utf8");
    for (const rule of CONTENT_RULES) {
      rule.pattern.lastIndex = 0;
      for (const match of source.matchAll(rule.pattern)) {
        violations.push({
          type: rule.type,
          file: path,
          line: lineNumber(source, match.index),
          detail: match[0],
        });
      }
    }
  }

  return violations.sort((left, right) =>
    `${left.file}:${String(left.line).padStart(8, "0")}:${left.type}`.localeCompare(
      `${right.file}:${String(right.line).padStart(8, "0")}:${right.type}`,
    ),
  );
}

export async function main(rootDir = root) {
  const violations = await analyzeSqliteOnly(rootDir);
  if (violations.length === 0) {
    console.log("SQLite-only persistence gate: OK");
    return;
  }
  console.error("SQLite-only persistence gate: FAIL");
  for (const violation of violations) {
    console.error(
      `  [${violation.type}] ${violation.file}:${violation.line}: ${violation.detail}`,
    );
  }
  process.exitCode = 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
