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
  "AITracker-macOS-arm64.dmg",
  "AITracker-macOS-x64.dmg",
  "AITracker-Windows-arm64.exe",
  "AITracker-Windows-x64.exe",
]);

/**
 * electron-builder templates that render exactly those four names. `${arch}`
 * stays, because it selects the architecture; `${version}` (or any other
 * version reference) may not appear in an artifact name.
 */
export const EXPECTED_TEMPLATES = Object.freeze([
  "${productName}-macOS-${arch}.${ext}",
  "${productName}-Windows-${arch}.${ext}",
]);

/** `${version}`, `${ buildVersion }`, `${env.VERSION}` … */
const VERSION_PLACEHOLDER = /\$\{[^}]*\bversion\b[^}]*\}/iu;

const ARTIFACT_NAME_LINE = /^\s+artifactName:\s*(.+?)\s*$/gmu;

/**
 * Every module that names an installer file, with the names it must contain.
 *
 * A rename has to reach all of them in one release: a packaging config that
 * renders new names while release-metadata.json still records the old ones
 * makes every install of 1.0.3 and later reject the document and report a
 * download failure, because the client requires the name in the metadata to be
 * an asset of that same release. `scripts/verify-release-asset-agreement.mjs`
 * then re-checks the assembled release, so the pairing is verified twice: once
 * here against the sources, once against the actual asset list.
 */
const ARTIFACT_NAME_SOURCES = Object.freeze([
  {
    path: "scripts/verify-release-contract.mjs",
    names: [
      "AITracker-macOS-arm64.dmg",
      "AITracker-macOS-x64.dmg",
      "AITracker-Windows-arm64.exe",
      "AITracker-Windows-x64.exe",
    ],
  },
  {
    path: "scripts/release-metadata.mjs",
    names: [
      "AITracker-macOS-arm64.dmg",
      "AITracker-macOS-x64.dmg",
      "AITracker-Windows-arm64.exe",
      "AITracker-Windows-x64.exe",
    ],
  },
]);

/** The installer file names a module records, in the order it records them. */
function installerNamesIn(text) {
  return [...text.matchAll(/"([^"\\/]+\.(?:dmg|exe))"/gu)].map(
    (match) => match[1],
  );
}

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

  for (const { path, names } of ARTIFACT_NAME_SOURCES) {
    let text;
    try {
      text = await readFile(join(rootDir, path), "utf8");
    } catch (error) {
      problems.push(
        `unable to read ${path}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    for (const name of names) {
      if (!text.includes(`"${name}"`)) {
        problems.push(`${path} does not name ${name}`);
      }
    }
    // The four names must also be the same set, in the same order: a module
    // that records fewer names, or the same names against the wrong platforms,
    // is exactly the half-rename the release breaks on.
    const recorded = installerNamesIn(text);
    if (recorded.join(",") !== names.join(",")) {
      problems.push(
        `${path} records ${recorded.join(", ") || "no installer names"}; ` +
          `each module must name all four in the same order (${names.join(", ")})`,
      );
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
