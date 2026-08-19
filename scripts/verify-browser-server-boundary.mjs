// P6-T6-03: browser/server boundary gate.
//
// Blocks server-only code from entering the browser graph:
//   1. `*.server.ts` files must never be statically imported by browser-safe
//      modules (routes, presentation, query facades, components).
//   2. `node:*` builtins must never be statically imported by browser-safe
//      modules (dynamic imports inside `.server.ts` are fine).
//   3. Module presentation files must not re-export server APIs.
//   4. `src/modules/**` business modules must never statically import
//      `node:sqlite` (business logic reaches SQLite only through the platform
//      Repository/Port); the violation type is `business-node-sqlite-import`.
//   5. Inside the platform storage layers (`src/platform/database/**`,
//      `src/platform/persistence/**`) only `infrastructure/**` may statically
//      import `node:sqlite`. Contract, host, probe, backup, integrity and
//      recovery modules must reach the driver through a narrow
//      `infrastructure/*.server.ts` export; the violation type is
//      `platform-node-sqlite-outside-infrastructure`.
//
// The browser-safe root set is: src/routes, src/components, src/app (except
// *.server.ts), src/lib (except *.server.ts), src/modules/*/presentation,
// src/modules/*/query.ts, src/modules/*/contracts.ts, src/modules/*/index.ts.
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx"];

/**
 * Repo-relative, forward-slash path of `filePath`.
 *
 * `rootDir` is explicit so path-scoped rules (`src/modules/**`,
 * `src/platform/**`) can be exercised against a temporary fixture tree instead
 * of only against this repository: with a hard-coded root, a fixture file
 * resolved to `../../tmp/...` and every `startsWith("src/...")` rule silently
 * matched nothing.
 */
function toRepoPath(filePath, rootDir = root) {
  return relative(rootDir, filePath).split(sep).join("/");
}

function isSourceFile(name) {
  return SOURCE_EXTENSIONS.some((extension) => name.endsWith(extension));
}

async function listSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return listSourceFiles(path);
      return entry.isFile() && isSourceFile(entry.name) ? [path] : [];
    }),
  );
  return nested.flat();
}

function isSourceName(filePath) {
  return SOURCE_EXTENSIONS.some((extension) => filePath.endsWith(extension));
}

/**
 * Files that are statically bundled into the browser graph. Anything else
 * (server modules reached via dynamic import, node tests, generated files)
 * is outside the check.
 */
function isBrowserGraphFile(repoPath) {
  if (!isSourceName(repoPath)) return false;
  if (/\.test\.(?:[cm]?[jt]sx?)$/.test(repoPath)) return false;
  if (/\.generated\.ts$/.test(repoPath)) return false;
  if (/\.server\.(?:[cm]?[jt]sx?)$/.test(repoPath)) return false;
  if (/^src\/modules\/[^/]+\/infrastructure\//.test(repoPath)) return false;
  if (/^src\/modules\/[^/]+\/application\//.test(repoPath)) return false;
  if (/^src\/modules\/[^/]+\/(?:api\.server|server)\./.test(repoPath))
    return false;
  if (/^src\/platform\/persistence\/infrastructure\//.test(repoPath))
    return false;
  if (/^src\/platform\/database\/infrastructure\//.test(repoPath)) return false;
  if (/^src\/platform\/snapshot-runtime\//.test(repoPath)) return false;
  if (/^src\/platform\/discovery\//.test(repoPath)) return false;
  if (/^src\/platform\/runtime\//.test(repoPath)) return false;
  if (/^src\/platform\/observability\/infrastructure\//.test(repoPath))
    return false;
  if (/^src\/server\.ts$/.test(repoPath)) return false;
  // Server-only lib helpers consumed exclusively by scanners/collectors.
  if (
    /^src\/lib\/local-usage\/(?:dsh-zstd|project-path|session-id)\.ts$/.test(
      repoPath,
    )
  )
    return false;
  if (/^src\/lib\/local-usage\/get-usage-sources\.ts$/.test(repoPath))
    return false;
  return true;
}

/** A file that defines createServerFn RPCs is browser-entry by construction. */
function definesServerFn(source) {
  return /createServerFn\s*\(/.test(source);
}

/** Static import specifiers that pull in the raw SQLite driver. */
function isSqliteDriverSpecifier(importSource) {
  return importSource === "node:sqlite" || importSource === "sqlite";
}

/**
 * Platform storage layers whose driver access must stay inside
 * `infrastructure/**`. The rule is written generically so a second storage
 * layer inherits it without a code change.
 */
const PLATFORM_STORAGE_ROOTS = [
  "src/platform/database/",
  "src/platform/persistence/",
];

/**
 * True when `repoPath` belongs to a platform storage layer but is NOT one of
 * the two places allowed to name `node:sqlite`:
 *   - `infrastructure/**` �?the only production home of the driver;
 *   - co-located `*.test.*` files �?fixtures legitimately create corrupt or
 *     foreign databases with the driver, and test files never ship in any
 *     bundle. Production modules get no such exemption.
 */
function isPlatformDriverRestricted(repoPath) {
  if (!isSourceName(repoPath)) return false;
  if (!PLATFORM_STORAGE_ROOTS.some((root) => repoPath.startsWith(root))) {
    return false;
  }
  if (/(?:^|\/)infrastructure\//.test(repoPath)) return false;
  if (/\.test\.(?:[cm]?[jt]sx?)$/.test(repoPath)) return false;
  return true;
}

/**
 * Static imports: `import �?from "x"`, `import "x"`, re-exports
 * `export { a } from "x"` (not dynamic).
 *
 * Only VALUE imports are collected: `import type �?from "x"` and dynamic
 * import() specifiers are erased at compile time and never reach the bundle.
 * A module that mixes a value import with a type import of the same specifier
 * (e.g. `import { fn } from "x"` + `import type { T } from "x"`) therefore
 * keeps the specifier �?the historical false negative that let
 * `version-check.ts �?version-check.server.ts` slip through.
 *
 * Patterns are anchored to the start of a statement (file start or line start
 * with optional indentation) so prose inside comments or template literals
 * that contains the word "import" can never be misread as a static edge.
 *
 * Known conservative edge: `import { type A } from "x"` (inline type-only
 * binding) is treated as a value import. That can only over-report, never
 * under-report, and the repository avoids that form for `.server` modules.
 */
function extractStaticImports(source) {
  const valueImports = new Set();
  // Value import statements (`import �?from "x"`), excluding the `import type`
  // prefix form.
  for (const match of source.matchAll(
    /(?:^|\n)[ \t]*import\s+(?!type\b)[^"'()]+from\s*["']([^"']+)["']/g,
  ))
    valueImports.add(match[1]);
  // Side-effect imports without bindings: `import "x"`.
  for (const match of source.matchAll(
    /(?:^|\n)[ \t]*import\s*["']([^"']+)["']/g,
  ))
    valueImports.add(match[1]);
  // Re-exports: `export { a } from "x"`, `export * from "x"`, `export { default } from "x"`.
  for (const match of source.matchAll(
    /(?:^|\n)[ \t]*export\s+(?!type\b)(?:[^"'(){}]*|\{[^}]*\})\s*from\s*["']([^"']+)["']/g,
  ))
    valueImports.add(match[1]);
  return [...valueImports];
}

function resolveRelativeImport(sourceFile, importSource, sourceFiles) {
  if (!importSource.startsWith(".")) return undefined;
  const base = resolve(dirname(sourceFile), importSource);
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => resolve(base, `index${extension}`)),
  ];
  return candidates.find((candidate) => sourceFiles.has(candidate));
}

export async function analyzeBrowserServerBoundary(rootDir = root) {
  const sourceRoot = resolve(rootDir, "src");
  const files = (await listSourceFiles(sourceRoot)).sort();
  const sourceFiles = new Set(files);
  const violations = [];

  for (const file of files) {
    const repoPath = toRepoPath(file, rootDir);
    if (!isBrowserGraphFile(repoPath)) continue;
    const source = await readFile(file, "utf8");
    // ServerFn definition files are the intended browser entry for RPCs;
    // their handlers must still load server logic dynamically.
    if (definesServerFn(source)) continue;
    const imports = extractStaticImports(source);

    for (const importSource of imports) {
      if (
        /^node:/.test(importSource) ||
        importSource === "fs" ||
        importSource === "path" ||
        importSource === "os" ||
        importSource === "child_process"
      ) {
        violations.push({
          type: "browser-node-builtin",
          file: repoPath,
          detail: importSource,
        });
      }
    }

    for (const importSource of imports) {
      const target = resolveRelativeImport(file, importSource, sourceFiles);
      if (!target) continue;
      const targetPath = toRepoPath(target, rootDir);
      if (/(?:^|\/)[^/]+\.server\.(?:[cm]?[jt]sx?)$/.test(targetPath)) {
        violations.push({
          type: "browser-static-server-import",
          file: repoPath,
          detail: targetPath,
        });
      }
    }
  }

  // Business modules must reach SQLite only through the platform
  // Repository/Port. This pass scans the ENTIRE `src/modules/**` source tree �?
  // including `*.server.ts`, `infrastructure/`, `application/` and tests �?for
  // static `node:sqlite` imports, independent of the browser-graph membership
  // used above.
  for (const file of files) {
    const repoPath = toRepoPath(file, rootDir);
    if (!/^src\/modules\//.test(repoPath)) continue;
    if (!isSourceName(repoPath)) continue;
    const source = await readFile(file, "utf8");
    for (const importSource of extractStaticImports(source)) {
      if (isSqliteDriverSpecifier(importSource)) {
        violations.push({
          type: "business-node-sqlite-import",
          file: repoPath,
          detail: importSource,
        });
      }
    }
  }

  // Platform storage layers: the driver import may only appear inside
  // `infrastructure/**`. Everything else �?contracts, database host, capability
  // probe, migration runner, backup, integrity, recovery �?must go through a
  // narrow `infrastructure/*.server.ts` export, so a future refactor cannot
  // quietly re-introduce `new DatabaseSync(...)` in a business-facing module.
  // Only VALUE imports count: `import type { DatabaseSync } from "node:sqlite"`
  // is erased at compile time and carries no runtime dependency.
  for (const file of files) {
    const repoPath = toRepoPath(file, rootDir);
    if (!isPlatformDriverRestricted(repoPath)) continue;
    const source = await readFile(file, "utf8");
    for (const importSource of extractStaticImports(source)) {
      if (isSqliteDriverSpecifier(importSource)) {
        violations.push({
          type: "platform-node-sqlite-outside-infrastructure",
          file: repoPath,
          detail: importSource,
        });
      }
    }
  }

  return violations.sort((a, b) =>
    `${a.type}:${a.file}:${a.detail}`.localeCompare(
      `${b.type}:${b.file}:${b.detail}`,
    ),
  );
}

export async function main(rootDir = root) {
  const violations = await analyzeBrowserServerBoundary(rootDir);
  if (violations.length > 0) {
    console.error("browser/server boundary gate: FAIL");
    for (const violation of violations) {
      console.error(
        `  [${violation.type}] ${violation.file}: ${violation.detail}`,
      );
    }
    process.exitCode = 1;
  } else {
    console.log("browser/server boundary gate: OK");
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
