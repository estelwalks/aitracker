import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const DEFAULT_ROOT = resolve(new URL("..", import.meta.url).pathname);
const EXCLUDED_DIRS = new Set([
  ".claude",
  ".git",
  ".nitro",
  ".output",
  ".turbo",
  ".vercel",
  ".next",
  "build",
  "coverage",
  "dist",
  "docs",
  "fixtures",
  "node_modules",
  "out",
  "release",
  "test-results",
]);
const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".config",
  ".js",
  ".json",
  ".mjs",
  ".ts",
  ".tsx",
  ".toml",
  ".yaml",
  ".yml",
]);

const RULES = [
  {
    id: "local-absolute-path",
    pattern:
      /(?:\/Users\/[A-Za-z][A-Za-z0-9._-]{2,}|\/home\/[A-Za-z][A-Za-z0-9._-]{2,}|[A-Za-z]:\\Users\\[A-Za-z][A-Za-z0-9._-]{2,})/g,
  },
  { id: "tokentracker-residue", pattern: /token[-_ ]?tracker(?:-cli)?/gi },
  {
    id: "credential-value",
    pattern:
      /(?:sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})/g,
  },
  {
    id: "private-import",
    pattern:
      /(?:from|import|require\s*\()\s*["'](?:file:\/\/|\/[Uu]sers\/|\/home\/|[A-Za-z]:\\Users\\)/g,
  },
];

function isCandidate(file) {
  if (file === "scripts/check-open-source-hygiene.mjs") return false;
  if (/\.(?:test|spec)\.[^.]+$/.test(file)) return false;
  if (file.endsWith(".lockb")) return false;
  return SOURCE_EXTENSIONS.has(file.slice(file.lastIndexOf(".")));
}

function walk(root, current = root, files = []) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) continue;
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) walk(root, absolute, files);
    else {
      const name = relative(root, absolute).replaceAll("\\", "/");
      if (isCandidate(name)) files.push(absolute);
    }
  }
  return files;
}

export function scanRepository(root = DEFAULT_ROOT) {
  const findings = [];
  for (const file of walk(root)) {
    const content = readFileSync(file, "utf8");
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const rule of RULES) {
        rule.pattern.lastIndex = 0;
        if (rule.pattern.test(line)) {
          findings.push({
            file: relative(root, file).replaceAll("\\", "/"),
            line: index + 1,
            rule: rule.id,
            preview: line.trim().slice(0, 160),
          });
        }
      }
    });
  }
  return findings;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)
) {
  const root = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_ROOT;
  if (!existsSync(root)) {
    console.error(`Repository root does not exist: ${root}`);
    process.exitCode = 2;
  } else {
    const findings = scanRepository(root);
    if (process.argv.includes("--json"))
      console.log(JSON.stringify(findings, null, 2));
    else if (findings.length) {
      for (const finding of findings)
        console.error(
          `${finding.file}:${finding.line} [${finding.rule}] ${finding.preview}`,
        );
    } else console.log("open-source hygiene check passed");
    process.exitCode = findings.length ? 1 : 0;
  }
}
