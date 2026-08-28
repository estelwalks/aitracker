// Renderer-bundle SQLite/secret leak gate (T-04-04 §14.4; review finding P2-15).
//
// Usage: node scripts/verify-bundle-no-sqlite.mjs [--output-dir <path>]
//
// Scans the built browser assets under `.output/public/**/*.js` and fails when
// any of them contains a marker that must never reach a renderer:
//   * `node:sqlite` / `DatabaseSync` — the driver or its class name;
//   * `aitracker.v1.db`            — the database file name;
//   * `secure_secrets`             — the ciphertext table name.
//
// The Nitro build emits TanStack Start server-function chunks into the same
// `.output/public/assets` directory (`*.server-*.js`, e.g.
// `legacy-usage-collector.server-XXXX.js`). Those modules execute only in the
// Node server handler, so they are not part of the browser-execution
// assertion — but a server chunk that carries a forbidden marker means server
// implementation (database paths, secret handling, schema) reached
// `.output/public`, where the Electron local server previously served it
// before capability-token validation. That is a hard FAIL, never a WARN.
// Every server chunk present in public is listed with the markers it contains;
// marker hits inside them fail the gate exactly like browser chunks.
// `.output/server/**` is out of scope by design.
//
// Exit code 0 when clean; 1 when a marker is found or `.output/public` is
// missing (run `npm run build` first).
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Markers that must not appear in any browser-executed chunk. */
const FORBIDDEN_MARKERS = [
  "node:sqlite",
  "DatabaseSync",
  "aitracker.v1.db",
  "secure_secrets",
];

/**
 * Server-function chunk pattern. `*.server-<hash>.js` is emitted by the
 * TanStack Start / Nitro server-function split and runs in Node only.
 */
const SERVER_CHUNK_PATTERN = /\.server-[^/\\]*\.js$/;

function toRepoPath(filePath) {
  return relative(root, filePath).split(sep).join("/");
}

function parseArgs(argv) {
  let outputDir = join(root, ".output", "public");
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--output-dir") {
      const value = argv[index + 1];
      if (typeof value !== "string" || value === "" || value.startsWith("--")) {
        throw new Error("--output-dir requires a directory path argument");
      }
      outputDir = resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${argv[index]}`);
  }
  return outputDir;
}

async function listJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return listJavaScriptFiles(path);
      return entry.isFile() && entry.name.endsWith(".js") ? [path] : [];
    }),
  );
  return nested.flat();
}

/** Every marker hit in one file, with 1-based line numbers. */
function findMarkerHits(source) {
  const hits = [];
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    for (const marker of FORBIDDEN_MARKERS) {
      if (lines[index].includes(marker)) {
        hits.push({ marker, line: index + 1 });
      }
    }
  }
  return hits;
}

export async function analyzeBundle(outputDir) {
  const files = (await listJavaScriptFiles(outputDir)).sort();
  const sources = new Map();
  for (const file of files) {
    sources.set(file, await readFile(file, "utf8"));
  }

  const serverChunks = [];
  const violations = [];
  let scanned = 0;

  for (const file of files) {
    const repoPath = toRepoPath(file);
    const source = sources.get(file) ?? "";
    if (SERVER_CHUNK_PATTERN.test(file)) {
      // Server-function chunks are not browser-executed, so the hard assertion
      // below does not apply to them — but a marker inside one still means
      // server implementation landed in `.output/public/assets`, where the
      // local server previously served it before token validation. That is a
      // release-blocking FAIL (P1-1), not an informational WARN.
      for (const hit of findMarkerHits(source)) {
        violations.push({ file: repoPath, ...hit });
      }
      serverChunks.push({
        path: repoPath,
        markers: [
          ...new Set(findMarkerHits(source).map((hit) => hit.marker)),
        ].sort(),
      });
      continue;
    }
    scanned += 1;
    for (const hit of findMarkerHits(source)) {
      violations.push({ file: repoPath, ...hit });
    }
  }
  return { scanned, serverChunks, violations };
}

async function main() {
  let outputDir;
  try {
    outputDir = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(
      `verify-bundle-no-sqlite: ${error instanceof Error ? error.message : "invalid arguments"}`,
    );
    console.error(
      "usage: node scripts/verify-bundle-no-sqlite.mjs [--output-dir <path>]",
    );
    process.exitCode = 1;
    return;
  }

  try {
    const info = await stat(outputDir);
    if (!info.isDirectory()) throw new Error("not a directory");
  } catch {
    console.error(
      `verify-bundle-no-sqlite: ${toRepoPath(outputDir)} not found — run \`npm run build\` first`,
    );
    process.exitCode = 1;
    return;
  }

  const { scanned, serverChunks, violations } = await analyzeBundle(outputDir);
  console.log(`verify-bundle-no-sqlite: ${toRepoPath(outputDir)}`);
  console.log(`  browser chunks asserted: ${scanned}`);
  console.log(`  server chunks present in public: ${serverChunks.length}`);
  for (const chunk of serverChunks) {
    const markers =
      chunk.markers.length > 0
        ? `markers: ${chunk.markers.join(", ")}`
        : "no markers";
    console.log(`    - ${chunk.path} (${markers})`);
  }

  if (violations.length > 0) {
    console.error("\nverify-bundle-no-sqlite: FAIL");
    for (const violation of violations) {
      console.error(
        `  [${violation.marker}] ${violation.file}:${violation.line}`,
      );
    }
    process.exitCode = 1;
    return;
  }
  console.log(
    `\nverify-bundle-no-sqlite: OK (markers checked: ${FORBIDDEN_MARKERS.join(", ")})`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
