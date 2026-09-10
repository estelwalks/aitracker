#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Release artifact names are versionless by contract. `releases/latest/download`
 * resolves an asset name against the newest release, so the URL the READMEs,
 * the desktop updater and `npx @estelwalks/aitracker` all use stays valid only
 * while the name never changes between releases. Reintroducing a `${version}`
 * placeholder into electron-builder.yml would silently break every one of those
 * URLs, and nothing else in the pipeline would notice.
 *
 * The app version is unaffected: it still comes from package.json into
 * app.asar's Info.plist and into release-metadata.json's appVersion/gitTag.
 */
export const PACKAGING_CONFIG = "electron-builder.yml";

export const EXPECTED_ARTIFACT_NAMES = Object.freeze([
  "AITracker-arm64.dmg",
  "AITracker-x64.dmg",
  "AITracker-Setup-arm64.exe",
  "AITracker-Setup-x64.exe",
]);

/**
 * electron-builder templates that render exactly those four names. `${arch}`
 * stays, because it selects the architecture; `${version}` (or any other
 * version reference) may not appear in an artifact name.
 */
const EXPECTED_TEMPLATES = Object.freeze([
  "${productName}-${arch}.${ext}",
  "${productName}-Setup-${arch}.${ext}",
]);

/** `${version}`, `${ buildVersion }`, `${env.VERSION}` … */
const VERSION_PLACEHOLDER = /\$\{[^}]*\bversion\b[^}]*\}/iu;

const ARTIFACT_NAME_LINE = /^\s+artifactName:\s*(.+?)\s*$/gmu;

/** Modules that must keep naming the four installers explicitly. */
const ARTIFACT_NAME_SOURCES = Object.freeze([
  "scripts/verify-release-contract.mjs",
  "scripts/release-metadata.mjs",
]);

export function inspectPackagingConfig({ config }) {
  const problems = [];
  const declared = [...config.matchAll(ARTIFACT_NAME_LINE)].map((match) =>
    match[1].trim().replace(/^["']|["']$/gu, ""),
  );

  const withVersion = declared.filter((value) =>
    VERSION_PLACEHOLDER.test(value),
  );
  if (withVersion.length > 0) {
    problems.push(
      `${PACKAGING_CONFIG} puts a version in an artifact name, which breaks ` +
        `releases/latest/download/<name>: ${withVersion.join(", ")}`,
    );
  }

  for (const template of EXPECTED_TEMPLATES) {
    if (!declared.includes(template)) {
      problems.push(
        `${PACKAGING_CONFIG} must declare artifactName ${template} (declared: ${declared.join(", ") || "none"})`,
      );
    }
  }
  return { problems, declared };
}

export async function verifyReleaseArtifactNames({
  rootDir = PROJECT_ROOT,
} = {}) {
  const problems = [];
  let config;
  try {
    config = await readFile(join(rootDir, PACKAGING_CONFIG), "utf8");
  } catch (error) {
    return [
      `unable to read ${PACKAGING_CONFIG}: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }
  problems.push(...inspectPackagingConfig({ config }).problems);

  for (const path of ARTIFACT_NAME_SOURCES) {
    let text;
    try {
      text = await readFile(join(rootDir, path), "utf8");
    } catch (error) {
      problems.push(
        `unable to read ${path}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    for (const name of EXPECTED_ARTIFACT_NAMES) {
      if (!text.includes(`"${name}"`)) {
        problems.push(`${path} does not name ${name}`);
      }
    }
  }
  return problems;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  const problems = await verifyReleaseArtifactNames(
    process.argv[2] ? { rootDir: resolve(process.argv[2]) } : {},
  );
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    console.error(
      `verify-release-artifact-names: FAIL (${problems.length} problem${problems.length === 1 ? "" : "s"})`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      `verify-release-artifact-names: PASS (${EXPECTED_ARTIFACT_NAMES.length} versionless installer names)`,
    );
  }
}
