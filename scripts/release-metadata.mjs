#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertAllowedDownloadUrl,
  assertValidChannel,
  assertValidVersion,
  LATEST_DOWNLOAD_BASE_URL,
  REPOSITORY,
  validateReleaseMetadata,
} from "../packages/cli/src/release-metadata.mjs";

/**
 * Every platform a release publishes, down to the file each one uses.
 *
 * Installer names carry no version, so `releases/latest/download/<name>` stays
 * valid across releases and is what the READMEs and the download page use.
 * Clients from 1.0.3 onward resolve an update through this record alone: the
 * name is matched against the selected release's own assets and the bytes are
 * verified against `sha256`, so the release page no longer has to carry a
 * second, versioned copy of every installer.
 *
 * `win32-arm64` is listed again: the compatibility window that kept 1.0.0 and
 * 1.0.1 updating themselves closed at 1.0.3, and those clients are the only
 * reason a platform key had to be withheld.
 */
/**
 * The installer names each platform records, in order. Every module that names
 * an installer file lists these same six in this same order — the first four in
 * the main `release-metadata.json`, plus the two Linux AppImages in the
 * companion `release-metadata-linux.json`.
 * `scripts/verify-release-artifact-names.mjs` enforces that agreement, so a
 * rename has to reach every module at once.
 */
const MACOS_ARM64 = "AITracker-macOS-arm64.dmg";
const MACOS_X64 = "AITracker-macOS-x64.dmg";
const WINDOWS_ARM64 = "AITracker-Windows-arm64.exe";
const WINDOWS_X64 = "AITracker-Windows-x64.exe";
const LINUX_X64 = "AITracker-Linux-x64.AppImage";

/**
 * The two Linux system packages attached to every release beside the AppImage.
 *
 * They are named here, and attached by the release workflow, but deliberately
 * NOT recorded in `release-metadata-linux.json`: that document allows exactly
 * one artifact per platform key, and the CLI's validator rejects an artifact
 * carrying an unknown field — so widening the record would make every shipped
 * client reject the whole document. A deb/rpm install therefore updates through
 * its own package manager, not through the in-app updater, and the READMEs are
 * where these two names are advertised.
 *
 * `scripts/verify-release-artifact-names.mjs` requires this module to name them
 * in this order, so a release cannot drop one while the READMEs still link it.
 */
const LINUX_X64_DEB = "AITracker-Linux-x64.deb";
const LINUX_X64_RPM = "AITracker-Linux-x64.rpm";

/**
 * The Linux system packages published beside the AppImage but kept out of the
 * metadata document (see above). Exported so the release tests can assert they
 * are attached without widening the artifact record.
 */
export const LINUX_PACKAGE_NAMES = Object.freeze([
  LINUX_X64_DEB,
  LINUX_X64_RPM,
]);

const TARGET_FILES = Object.freeze([
  ["darwin-arm64", MACOS_ARM64],
  ["darwin-x64", MACOS_X64],
  ["win32-arm64", WINDOWS_ARM64],
  ["win32-x64", WINDOWS_X64],
]);

/**
 * Linux artifacts, published in their own `release-metadata-linux.json` rather
 * than in the main document.
 *
 * The main document must keep exactly its four keys: a shipped client older
 * than the Linux launch rejects any fifth key outright and stops updating
 * itself for every later release, because every later release carries the key.
 * Old clients never fetch this companion file, so Linux ships without stranding
 * them. (See dev-docs/linux/01-架构决策.md §3.1.)
 *
 * The AppImage is the installable artifact — it is what the in-app updater and
 * `npx @estelwalks/aitracker` hand to the user. The `.deb` is attached to the
 * release for people who prefer a system package, but it is deliberately NOT
 * recorded here: the metadata contract allows exactly one artifact per platform
 * key, and the updater prefers AppImage anyway.
 *
 * Only x64 is listed. An arm64 build has no artifact template yet — the Linux
 * `artifactName` spells the architecture out rather than using `${arch}`,
 * because electron-builder renders that as x86_64 for AppImage and amd64 for
 * deb. Adding arm64 means adding its own `linux.artifactName` override and a
 * second entry here, not just a new row.
 */
const LINUX_TARGET_FILES = Object.freeze([["linux-x64", LINUX_X64]]);

export function parseReleaseMetadataArgs(argv) {
  const options = {
    releaseDir: "release",
    version: undefined,
    channel: undefined,
    repository: REPOSITORY,
    output: "release/release-metadata.json",
    linuxOutput: "release/release-metadata-linux.json",
    checksums: "release/checksums.txt",
  };
  const valueOptions = new Set([
    "--release-dir",
    "--version",
    "--channel",
    "--repository",
    "--output",
    "--linux-output",
    "--checksums",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [maybeName, inlineValue] = arg.split("=", 2);
    if (!valueOptions.has(maybeName)) throw new Error(`unknown option: ${arg}`);
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--"))
      throw new Error(`${maybeName} requires a value`);
    const key = maybeName
      .slice(2)
      .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    options[key] = value;
  }
  if (!options.version) throw new Error("--version is required");
  assertValidVersion(options.version);
  options.channel ??= options.version.includes("-") ? "beta" : "stable";
  assertValidChannel(options.channel);
  if (options.repository !== REPOSITORY)
    throw new Error(`repository must be ${REPOSITORY}`);
  return options;
}

async function requiredFile(path) {
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error(`${path} is not a file`);
    return info;
  } catch (error) {
    if (error?.code === "ENOENT")
      throw new Error(`missing release artifact: ${path}`);
    throw error;
  }
}

/**
 * Hash one published artifact into its metadata entry. Versionless, matching
 * the installer name: the record pins the exact build through
 * appVersion/gitTag plus sha256 and size, not through the URL, so the download
 * link keeps resolving to the newest release.
 */
async function artifactEntry(directory, name) {
  const path = join(directory, name);
  const info = await requiredFile(path);
  const bytes = await readFile(path);
  const url = `${LATEST_DOWNLOAD_BASE_URL}${name}`;
  assertAllowedDownloadUrl(url);
  return {
    name,
    url,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: info.size,
  };
}

export async function buildReleaseMetadata({
  releaseDir,
  version,
  channel,
  repository = REPOSITORY,
}) {
  assertValidVersion(version);
  assertValidChannel(channel);
  if (repository !== REPOSITORY)
    throw new Error(`repository must be ${REPOSITORY}`);
  const directory = resolve(releaseDir);
  const artifacts = {};
  for (const [platform, name] of TARGET_FILES) {
    artifacts[platform] = await artifactEntry(directory, name);
  }
  return validateReleaseMetadata({
    schemaVersion: 1,
    appVersion: version,
    channel,
    repository,
    gitTag: `v${version}`,
    artifacts,
  });
}

/**
 * The Linux companion document. It repeats the four always-published macOS and
 * Windows entries (the CLI validator requires them, and repeating them lets the
 * CLI read this file as a complete metadata document) and adds `linux-x64`.
 *
 * Throws when the x64 AppImage is absent, so a release that claims Linux
 * support but did not build it fails loudly instead of publishing a metadata
 * file the updater cannot use.
 */
export async function buildLinuxReleaseMetadata({
  releaseDir,
  version,
  channel,
  repository = REPOSITORY,
}) {
  assertValidVersion(version);
  assertValidChannel(channel);
  if (repository !== REPOSITORY)
    throw new Error(`repository must be ${REPOSITORY}`);
  const directory = resolve(releaseDir);
  const artifacts = {};
  for (const [platform, name] of TARGET_FILES) {
    artifacts[platform] = await artifactEntry(directory, name);
  }
  for (const [platform, name] of LINUX_TARGET_FILES) {
    artifacts[platform] = await artifactEntry(directory, name);
  }
  return validateReleaseMetadata({
    schemaVersion: 1,
    appVersion: version,
    channel,
    repository,
    gitTag: `v${version}`,
    artifacts,
  });
}

export function formatChecksums(metadata) {
  validateReleaseMetadata(metadata);
  return `${Object.values(metadata.artifacts)
    .map((artifact) => `${artifact.sha256}  ${artifact.name}`)
    .join("\n")}\n`;
}

async function writeTextOutput(path, contents) {
  if (path === "-") {
    process.stdout.write(contents);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}

export async function generateReleaseMetadata(options) {
  const metadata = await buildReleaseMetadata(options);
  const metadataText = `${JSON.stringify(metadata, null, 2)}\n`;
  await writeTextOutput(options.output, metadataText);
  // The Linux companion document is additive: it never replaces the four-key
  // main document, so a shipped pre-Linux client keeps resolving its own
  // updates. See the LINUX_TARGET_FILES comment.
  const linuxMetadata = await buildLinuxReleaseMetadata(options);
  await writeTextOutput(
    options.linuxOutput,
    `${JSON.stringify(linuxMetadata, null, 2)}\n`,
  );
  await writeTextOutput(options.checksums, formatChecksums(metadata));
  return metadata;
}

// Path comparison instead of `file://${process.argv[1]}`: on Windows
// import.meta.url is `file:///D:/...` while the naive interpolation produces
// `file://D:\...`, so the entry block would never run and the CLI would exit 0
// without generating anything.
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  try {
    const options = parseReleaseMetadataArgs(process.argv.slice(2));
    await generateReleaseMetadata(options);
  } catch (error) {
    console.error(
      `release-metadata: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
