/**
 * Bundles the license/notice files of production dependencies into the
 * packaged application.
 *
 * Why this exists: electron-builder.yml's `files` whitelist excludes all of
 * node_modules except the two main-process runtime packages
 * (@estelwalks/agent-threat-scanner and zod), and the renderer's dependencies
 * are compiled into the web bundle shipped via `extraResources`. So no
 * dependency license file reaches the packaged app on its own. The root
 * NOTICE (and docs/RELEASE_CHECKLIST.md) promise that binary distributions
 * preserve the corresponding package license files; this script implements
 * that promise.
 *
 * Scope: the *runtime* dependency closure of the root package.json
 * `dependencies` — each package followed through its own `dependencies`
 * field, matching npm install semantics (devDependencies never enter it).
 * Every resolved package directory is located with Node's standard
 * node_modules upward lookup, so hoisted and nested copies are both found.
 * For each resolved package, license-like files (LICENSE*, LICENCE*,
 * NOTICE*, COPYING*, COPYLEFT*, PATENTS*, UNLICENSE* — with the common
 * extension/qualifier spellings) are copied into
 * `<licensesRoot>/<package-name>/`. Scoped names keep their slash, so
 * `@scope/name` becomes `licenses/@scope/name/`, mirroring node_modules.
 *
 * Wiring: electron/after-pack.cjs imports this from its afterPack hook so it
 * runs automatically on every platform package before the app is archived or
 * (re)signed. Standalone use:
 *
 *   node scripts/copy-license-files.mjs <projectDir> <licensesRoot>
 *
 * Determinism: dependencies are expanded in sorted name order, first-seen
 * package directories win (duplicate names across versions are reported as
 * warnings and skipped), and the licensesRoot directory is cleared before
 * copying so stale entries cannot survive a dependency change.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PROJECT_DIR = resolve(
  dirname(dirname(fileURLToPath(import.meta.url))),
);

// Legal-text file names shipped in a package root, matched case-insensitively
// on the uppercased base name. The optional tail requires a non-alphanumeric
// separator first so LICENSE, LICENSE-MIT, LICENSE.md, NOTICE.txt and COPYING
// match, while README, LICENSED and unrelated documentation do not.
const LEGAL_FILE_PATTERN =
  /^(LICENSE|LICENCE|NOTICE|COPYING|COPYLEFT|PATENTS|UNLICENSE)(?:[^A-Z0-9].*)?$/;

function readPackageJson(packageDir) {
  try {
    const parsed = JSON.parse(
      readFileSync(join(packageDir, "package.json"), "utf8"),
    );
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** Node-style upward node_modules lookup for `name` starting at `fromDir`. */
function resolveDependency(fromDir, name) {
  const segments = name.split("/");
  let current = fromDir;
  while (true) {
    const candidate = join(current, "node_modules", ...segments);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Sorted list of license-like file names present in a package directory. */
function findLegalFiles(packageDir) {
  let entries;
  try {
    entries = readdirSync(packageDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(
      (entry) =>
        entry.isFile() && LEGAL_FILE_PATTERN.test(entry.name.toUpperCase()),
    )
    .map((entry) => entry.name)
    .sort();
}

function warn(logger, message) {
  if (logger && typeof logger.warn === "function") logger.warn(message);
}

/**
 * Resolve the runtime dependency closure of `projectDir/package.json`.
 * Returns a Map of canonical package directory -> parsed package.json, in
 * deterministic first-seen order.
 */
function collectRuntimeClosure(projectDir, logger) {
  const rootPackage = readPackageJson(projectDir);
  if (!rootPackage) {
    throw new Error(`No package.json found at ${projectDir}`);
  }
  const rootDependencies = Object.keys(rootPackage.dependencies ?? {}).sort();
  const resolvedDirs = new Map();
  const expanded = new Set();
  const queue = rootDependencies.map((name) => ({ name, from: projectDir }));
  while (queue.length > 0) {
    const { name, from } = queue.shift();
    const expansionKey = `${from}|${name}`;
    if (expanded.has(expansionKey)) continue;
    expanded.add(expansionKey);
    const dir = resolveDependency(from, name);
    if (!dir) {
      warn(
        logger,
        `[copy-license-files] declared dependency not installed, skipping: ${name}`,
      );
      continue;
    }
    const canonical = resolve(dir);
    if (resolvedDirs.has(canonical)) continue;
    const pkg = readPackageJson(canonical);
    if (!pkg) continue;
    resolvedDirs.set(canonical, pkg);
    const transitive = Object.keys(pkg.dependencies ?? {}).sort();
    for (const depName of transitive) {
      queue.push({ name: depName, from: canonical });
    }
  }
  return resolvedDirs;
}

/**
 * Copy every resolved production dependency's license-like files into
 * `<licensesRoot>/<package-name>/`.
 *
 * @param {object} options
 * @param {string} options.projectDir root of the application (contains package.json and node_modules)
 * @param {string} options.licensesRoot destination directory for per-package license folders
 * @param {object} [options.logger] console-like logger (optional)
 * @returns {object} summary: copied packages, packages without legal files, skipped duplicates
 */
export function copyLicenseFiles({ projectDir, licensesRoot, logger }) {
  const resolvedDirs = collectRuntimeClosure(projectDir, logger);

  // Group by package name; on a version conflict the first (deterministic)
  // directory wins and the others are reported.
  const byName = new Map();
  const duplicatePackages = [];
  for (const [dir, pkg] of resolvedDirs) {
    const name = pkg.name;
    if (!name || typeof name !== "string") continue;
    if (byName.has(name)) {
      duplicatePackages.push(name);
      continue;
    }
    byName.set(name, {
      name,
      version: pkg.version ?? null,
      dir,
      files: findLegalFiles(dir),
    });
  }
  for (const name of [...new Set(duplicatePackages)].sort()) {
    warn(
      logger,
      `[copy-license-files] multiple versions of "${name}" resolved; keeping the first, skipping the rest`,
    );
  }

  rmSync(licensesRoot, { recursive: true, force: true });
  mkdirSync(licensesRoot, { recursive: true });

  const copied = [];
  const noLegalFiles = [];
  const ordered = [...byName.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  for (const record of ordered) {
    if (record.files.length === 0) {
      noLegalFiles.push(record.name);
      continue;
    }
    const targetDir = join(licensesRoot, record.name);
    mkdirSync(targetDir, { recursive: true });
    for (const file of record.files) {
      copyFileSync(join(record.dir, file), join(targetDir, file));
    }
    copied.push({
      name: record.name,
      version: record.version,
      files: record.files,
    });
  }
  return {
    licensesRoot,
    copied,
    noLegalFiles: noLegalFiles.sort(),
    duplicatePackages: [...new Set(duplicatePackages)].sort(),
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  const [projectDirArg, licensesRootArg] = process.argv.slice(2);
  const projectDir = projectDirArg
    ? resolve(projectDirArg)
    : DEFAULT_PROJECT_DIR;
  if (!licensesRootArg) {
    console.error(
      "Usage: node scripts/copy-license-files.mjs [projectDir] <licensesRoot>",
    );
    process.exitCode = 2;
  } else {
    try {
      const result = copyLicenseFiles({
        projectDir,
        licensesRoot: resolve(licensesRootArg),
        logger: console,
      });
      console.log(
        `[copy-license-files] bundled license files for ${result.copied.length} production packages into ${result.licensesRoot}`,
      );
      if (result.noLegalFiles.length > 0) {
        console.warn(
          `[copy-license-files] packages without a license file on disk: ${result.noLegalFiles.join(", ")}`,
        );
      }
    } catch (error) {
      console.error(
        `[copy-license-files] failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      process.exitCode = 1;
    }
  }
}
