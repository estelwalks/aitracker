#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The four versionless installer names every release publishes. The READMEs
 * link them through `/releases/latest/download/<name>`, which GitHub resolves
 * against the newest release. `scripts/verify-release-artifact-names.mjs` pins
 * these same names to electron-builder.yml, so a README can never document an
 * installer the packaging step does not produce.
 */
export const README_DOWNLOAD_NAMES = Object.freeze([
  "AITracker-arm64.dmg",
  "AITracker-x64.dmg",
  "AITracker-Setup-x64.exe",
  "AITracker-Setup-arm64.exe",
]);

/** Paths whose links must stay on the versionless installer contract. */
export const README_PATHS = Object.freeze([
  "README.md",
  "docs/README_CN.md",
  "docs/README_JA.md",
  "docs/README_KO.md",
]);

const LATEST_DOWNLOAD_PREFIX =
  "https://github.com/estelwalks/aitracker/releases/latest/download/";
// A pinned installer link such as releases/download/v1.0.1/AITracker-... is the
// drift this guard exists to prevent: it silently stops tracking new releases.
const PINNED_DOWNLOAD_PATTERN =
  /https:\/\/github\.com\/estelwalks\/aitracker\/releases\/download\/[^\s)"']+/gu;

/**
 * Documented install commands must not pin a version: the READMEs are the
 * release documentation, and `npx @<version>` silently stops following
 * releases. `latest` (stable) and `beta` are npm dist-tags, and the same
 * applies to the `@estelwalks/aitracker` package name.
 *
 * Only code that a reader may paste is checked. A version inside inline code
 * is prose ("pin `@estelwalks/aitracker@1.0.2` for an exact build") and is
 * removed before scanning.
 */
const PINNED_NPX_PATTERN =
  /@estelwalks\/aitracker@(?!latest\b|beta\b)[^\s)`]+/gu;
const INLINE_CODE_PATTERN = /`[^`]*`/gu;

export function inspectReadme({ path, text }) {
  const problems = [];
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    const commands = line.replace(INLINE_CODE_PATTERN, "``");
    for (const match of commands.matchAll(PINNED_NPX_PATTERN)) {
      problems.push(
        `${path}:${index + 1} pins a CLI version (${match[0]}); use ` +
          `@estelwalks/aitracker@latest (or @beta) so the command keeps working`,
      );
    }
    const lineNumber = index + 1;
    for (const match of line.matchAll(PINNED_DOWNLOAD_PATTERN)) {
      problems.push(
        `${path}:${lineNumber} pins a versioned installer URL (${match[0]}); ` +
          `use ${LATEST_DOWNLOAD_PREFIX}<name> with one of: ${README_DOWNLOAD_NAMES.join(", ")}`,
      );
    }
    let cursor = 0;
    while (true) {
      const start = line.indexOf(LATEST_DOWNLOAD_PREFIX, cursor);
      if (start === -1) break;
      cursor = start + LATEST_DOWNLOAD_PREFIX.length;
      const name = line.slice(cursor).match(/^[^\s)"'<>]+/u)?.[0] ?? "";
      if (!README_DOWNLOAD_NAMES.includes(name)) {
        problems.push(
          `${path}:${lineNumber} links the unknown latest-release asset "${name}"; ` +
            `published installer names are: ${README_DOWNLOAD_NAMES.join(", ")}`,
        );
      }
    }
  }
  // The guard is meaningless if the anchors disappear, e.g. after a rewrite
  // that drops the download section entirely.
  if (!text.includes(LATEST_DOWNLOAD_PREFIX)) {
    problems.push(
      `${path} contains no ${LATEST_DOWNLOAD_PREFIX} link; the install section must point at the versionless installer names`,
    );
  }
  return problems;
}

export async function verifyReadmeReleaseLinks({
  rootDir = PROJECT_ROOT,
} = {}) {
  const problems = [];
  const texts = new Map();
  for (const path of README_PATHS) {
    let text;
    try {
      text = await readFile(join(rootDir, path), "utf8");
    } catch (error) {
      problems.push(
        `unable to read ${path}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    texts.set(path, text);
    problems.push(...inspectReadme({ path, text }));
  }

  // Every published installer must be reachable from at least one README; a
  // name nobody links is a documentation gap.
  const joined = [...texts.values()].join("\n");
  for (const name of README_DOWNLOAD_NAMES) {
    if (!joined.includes(`${LATEST_DOWNLOAD_PREFIX}${name}`)) {
      problems.push(
        `no README links ${LATEST_DOWNLOAD_PREFIX}${name}; document every published installer name`,
      );
    }
  }

  return problems;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  const problems = await verifyReadmeReleaseLinks(
    process.argv[2] ? { rootDir: resolve(process.argv[2]) } : {},
  );
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    console.error(
      `verify-readme-release-links: FAIL (${problems.length} problem${problems.length === 1 ? "" : "s"})`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      `verify-readme-release-links: PASS (${README_PATHS.length} READMEs, ${README_DOWNLOAD_NAMES.length} installer names)`,
    );
  }
}
