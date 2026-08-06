// Reports architecture-boundary drift during the modular-monolith migration.
//
// This P0 verifier is intentionally report-only: it always exits successfully
// so the existing routes can be migrated incrementally. P8 promotes the same
// checks to a blocking CI gate after the migration allowlist reaches zero.
// Run: npm run verify:architecture
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ROUTE_LINE_LIMIT = 80;

/**
 * Temporary migration exceptions only. Each entry must contain:
 * - type: violation type emitted by this verifier
 * - file: repository-relative source file
 * - reason: why the exception is still necessary
 * - owner: accountable maintainer or team
 * - expiresAtPhase: delivery phase in which it must be removed (for example P3)
 *
 * Do not add wildcards, permanent exceptions, or executable configuration.
 */
export const MIGRATION_ALLOWLIST = Object.freeze([]);

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx"];
const ALLOWLIST_FIELDS = ["type", "file", "reason", "owner", "expiresAtPhase"];

function toRepoPath(root, filePath) {
  return relative(root, filePath).split(sep).join("/");
}

function isSourceFile(filePath) {
  return SOURCE_EXTENSIONS.some((extension) => filePath.endsWith(extension));
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

export function extractImportSources(source) {
  const imports = new Set();
  for (const pattern of [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
  ]) {
    for (const match of source.matchAll(pattern)) imports.add(match[1]);
  }
  return [...imports].sort();
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

function getModuleName(repoPath) {
  const match = /^src\/modules\/([^/]+)\//.exec(repoPath);
  return match?.[1];
}

function isPublicModuleEntry(repoPath, moduleName) {
  return new RegExp(
    `^src/modules/${moduleName}/(?:index|contracts)\\.(?:[cm]?[jt]sx?)$`,
  ).test(repoPath);
}

function routeHasForbiddenDirectImport(importSource) {
  return /(?:^|\/)(?:scanner|[^/]+\.server)(?:\.[cm]?[jt]sx?)?$/.test(
    importSource,
  );
}

function findRelativeImportCycles(graph) {
  const visited = new Set();
  const active = new Set();
  const stack = [];
  const cycles = [];
  const seen = new Set();

  function visit(file) {
    visited.add(file);
    active.add(file);
    stack.push(file);

    for (const dependency of graph.get(file) ?? []) {
      if (!visited.has(dependency)) {
        visit(dependency);
        continue;
      }
      if (!active.has(dependency)) continue;

      const cycle = [...stack.slice(stack.indexOf(dependency)), dependency];
      const key = cycle.join(" -> ");
      if (!seen.has(key)) {
        seen.add(key);
        cycles.push(cycle);
      }
    }

    stack.pop();
    active.delete(file);
  }

  for (const file of [...graph.keys()].sort()) {
    if (!visited.has(file)) visit(file);
  }
  return cycles;
}

export function validateAllowlist(allowlist) {
  return allowlist.flatMap((entry, index) => {
    const missing = ALLOWLIST_FIELDS.filter(
      (field) =>
        typeof entry?.[field] !== "string" || entry[field].trim() === "",
    );
    return missing.length === 0
      ? []
      : [
          `allowlist[${index}] is missing required field(s): ${missing.join(", ")}`,
        ];
  });
}

export function isAllowlisted(violation, allowlist) {
  return allowlist.some(
    (entry) => entry.type === violation.type && entry.file === violation.file,
  );
}

export async function analyzeProject(root, allowlist = MIGRATION_ALLOWLIST) {
  const sourceRoot = resolve(root, "src");
  const allowlistErrors = validateAllowlist(allowlist);
  if (!existsSync(sourceRoot)) {
    return { allowlistErrors, violations: [], suppressed: [] };
  }

  const files = (await listSourceFiles(sourceRoot)).sort();
  const sourceFiles = new Set(files);
  const contents = new Map(
    await Promise.all(
      files.map(async (file) => [file, await readFile(file, "utf8")]),
    ),
  );
  const graph = new Map();
  const violations = [];

  for (const file of files) {
    const repoPath = toRepoPath(root, file);
    const source = contents.get(file);
    const imports = extractImportSources(source);
    const dependencies = [];

    if (repoPath.startsWith("src/routes/")) {
      const lineCount = source.split(/\r?\n/).length;
      if (lineCount > ROUTE_LINE_LIMIT) {
        violations.push({
          type: "route-line-limit",
          file: repoPath,
          detail: `${lineCount} lines (limit ${ROUTE_LINE_LIMIT})`,
        });
      }
      for (const importSource of imports.filter(
        routeHasForbiddenDirectImport,
      )) {
        violations.push({
          type: "route-direct-server-import",
          file: repoPath,
          detail: importSource,
        });
      }
    }

    for (const importSource of imports) {
      const target = resolveRelativeImport(file, importSource, sourceFiles);
      if (!target) continue;
      dependencies.push(target);

      const fromModule = getModuleName(repoPath);
      const targetPath = toRepoPath(root, target);
      const targetModule = getModuleName(targetPath);
      if (
        fromModule &&
        targetModule &&
        fromModule !== targetModule &&
        !isPublicModuleEntry(targetPath, targetModule)
      ) {
        violations.push({
          type: "module-deep-import",
          file: repoPath,
          detail: `${importSource} -> ${targetPath}`,
        });
      }
    }
    graph.set(file, dependencies.sort());
  }

  for (const cycle of findRelativeImportCycles(graph)) {
    const formatted = cycle.map((file) => toRepoPath(root, file));
    violations.push({
      type: "relative-import-cycle",
      file: formatted[0],
      detail: formatted.join(" -> "),
    });
  }

  const sorted = violations.sort((a, b) =>
    `${a.type}:${a.file}:${a.detail}`.localeCompare(
      `${b.type}:${b.file}:${b.detail}`,
    ),
  );
  return {
    allowlistErrors,
    violations: sorted.filter(
      (violation) => !isAllowlisted(violation, allowlist),
    ),
    suppressed: sorted.filter((violation) =>
      isAllowlisted(violation, allowlist),
    ),
  };
}

export function formatReport(report) {
  const lines = [
    "architecture verify (report mode)",
    "─────────────────────────────────────────",
    `route line limit: ${ROUTE_LINE_LIMIT}`,
    `migration allowlist entries: ${MIGRATION_ALLOWLIST.length}`,
  ];

  if (report.allowlistErrors.length > 0) {
    lines.push("", "allowlist configuration errors:");
    lines.push(...report.allowlistErrors.map((error) => `  ! ${error}`));
  }

  if (report.violations.length === 0) {
    lines.push("", "No active architecture-boundary findings.");
  } else {
    lines.push("", `active findings: ${report.violations.length}`);
    for (const violation of report.violations) {
      lines.push(
        `  [${violation.type}] ${violation.file}: ${violation.detail}`,
      );
    }
  }

  if (report.suppressed.length > 0) {
    lines.push(
      "",
      `allowlisted migration findings: ${report.suppressed.length}`,
    );
  }
  lines.push(
    "",
    "Report mode only: exits 0; P8 promotes approved rules to blocking CI.",
  );
  return lines.join("\n");
}

export async function main(
  root = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
) {
  const report = await analyzeProject(root);
  console.log(formatReport(report));
  return report;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
