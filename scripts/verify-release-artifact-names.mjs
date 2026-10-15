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

/**
 * One entry per electron-builder target section that can produce an installer,
 * with the extensions that section renders and the architectures it builds.
 *
 * `${arch}` stays for macOS and Windows, because it selects the architecture;
 * `${version}` (or any other version reference) may not appear in an artifact
 * name. Linux deliberately spells the architecture out (`-x64`) instead of
 * using `${arch}`: electron-builder renders `${arch}` as `x86_64` for AppImage
 * and rpm and `amd64` for deb, which would give one platform three different
 * suffixes and break the single stable name the metadata, README links and CLI
 * resolve against.
 *
 * The deb and rpm sections repeat the `linux:` template on purpose — a shared
 * template is declared once under `linux:` and inherited by both — but they are
 * listed separately because each renders its own extension, and the guard below
 * requires every name here to exist in a real release.
 */
export const EXPECTED_TEMPLATE_SECTIONS = Object.freeze({
  dmg: {
    template: "${productName}-macOS-${arch}.${ext}",
    extensions: ["dmg"],
    archs: ["arm64", "x64"],
  },
  nsis: {
    template: "${productName}-Windows-${arch}.${ext}",
    extensions: ["exe"],
    archs: ["arm64", "x64"],
  },
  linux: {
    template: "${productName}-Linux-x64.${ext}",
    extensions: ["AppImage", "deb", "rpm"],
    archs: ["x64"],
  },
});

/**
 * The distinct templates the packaging config must declare. Only the `linux:`
 * template is asserted, because it is the one actually written in
 * electron-builder.yml: deb and rpm inherit it rather than repeating it.
 */
export const EXPECTED_TEMPLATES = Object.freeze([
  ...new Set(
    Object.values(EXPECTED_TEMPLATE_SECTIONS).map((entry) => entry.template),
  ),
]);

/** Expand every section to the installer names a release publishes. */
function renderArtifactNames() {
  const names = new Set();
  for (const { template, extensions, archs } of Object.values(
    EXPECTED_TEMPLATE_SECTIONS,
  )) {
    for (const extension of extensions) {
      for (const arch of archs) {
        names.add(
          template
            .replace("${productName}", "AITracker")
            .replace("${arch}", arch)
            .replace("${ext}", extension),
        );
      }
    }
  }
  return [...names];
}

/**
 * Every installer name a release publishes. The AppImage, deb and rpm all
 * appear here even though only the AppImage is recorded in
 * `release-metadata-linux.json`: the metadata contract permits one artifact per
 * platform key (the CLI's validator rejects an extra field outright, which is
 * why widening it would strand every shipped client), while the release still
 * has to publish all three because the READMEs link them.
 */
export const EXPECTED_ARTIFACT_NAMES = Object.freeze(renderArtifactNames());

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
const MACOS_NAMES = ["AITracker-macOS-arm64.dmg", "AITracker-macOS-x64.dmg"];
const WINDOWS_NAMES = [
  "AITracker-Windows-arm64.exe",
  "AITracker-Windows-x64.exe",
];

/**
 * Every published Linux installer. All three are built and attached to the
 * release; only the AppImage is recorded in `release-metadata-linux.json`,
 * because the metadata contract allows exactly one artifact per platform key.
 * Both modules below still have to name all three, so a release that forgets to
 * build one fails here rather than shipping a README link to a missing asset.
 */
const LINUX_NAMES = [
  "AITracker-Linux-x64.AppImage",
  "AITracker-Linux-x64.deb",
  "AITracker-Linux-x64.rpm",
];

const ARTIFACT_NAME_SOURCES = Object.freeze([
  {
    path: "scripts/verify-release-contract.mjs",
    names: [...MACOS_NAMES, ...WINDOWS_NAMES, ...LINUX_NAMES],
  },
  {
    // The metadata module names the deb and the rpm only in prose (it records
    // the AppImage alone), so its list is checked against the same three plus
    // the four it hashes. `installerNamesIn` below is what proves it.
    path: "scripts/release-metadata.mjs",
    names: [...MACOS_NAMES, ...WINDOWS_NAMES, ...LINUX_NAMES],
  },
]);

/** The installer file names a module records, in the order it records them. */
function installerNamesIn(text) {
  return [
    ...text.matchAll(/"([^"\\/]+\.(?:dmg|exe|AppImage|deb|rpm|tar\.gz))"/gu),
  ].map((match) => match[1]);
}

/**
 * The `dist:linux:*` scripts pass the target list on the command line, which
 * OVERRIDES `linux.target` in electron-builder.yml. A target added to the config
 * but not to the script is therefore built by nobody, and the release ships
 * without it — exactly how `rpm` was silently skipped on the first attempt.
 * Unpinned scripts (`electron-builder --linux`, no target arguments) inherit the
 * config and are left alone.
 */
export function inspectLinuxDistScripts({ scripts }) {
  const problems = [];
  const expected = EXPECTED_TEMPLATE_SECTIONS.linux.extensions.map(
    (extension) => (extension === "AppImage" ? "AppImage" : extension),
  );
  for (const [name, command] of Object.entries(scripts ?? {})) {
    if (!/^dist:linux/u.test(name) || typeof command !== "string") continue;
    const match = command.match(/electron-builder\s+--linux\s+([^&|;]+)/u);
    if (!match) continue;
    // Targets run up to the first flag; everything after it is an option and
    // its value (`--x64`, `--publish never`), not a target.
    const declared = [];
    for (const token of match[1].trim().split(/\s+/u)) {
      if (token.startsWith("-")) break;
      declared.push(token);
    }
    if (declared.length === 0) continue; // inherited from the config
    for (const target of expected) {
      if (!declared.includes(target)) {
        problems.push(
          `package.json ${name} passes "${declared.join(" ")}" to --linux, which overrides linux.target and omits ${target}; the release would publish no ${target}`,
        );
      }
    }
  }
  return problems;
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

  try {
    const packageJson = JSON.parse(
      await readFile(join(rootDir, "package.json"), "utf8"),
    );
    problems.push(...inspectLinuxDistScripts({ scripts: packageJson.scripts }));
  } catch (error) {
    problems.push(
      `unable to read package.json: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

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
    // The names must also be the same set, in the same order: a module that
    // records fewer names, or the same names against the wrong platforms, is
    // exactly the half-rename the release breaks on.
    const recorded = installerNamesIn(text);
    if (recorded.join(",") !== names.join(",")) {
      problems.push(
        `${path} records ${recorded.join(", ") || "no installer names"}; ` +
          `each module must name all of them in the same order (${names.join(", ")})`,
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
