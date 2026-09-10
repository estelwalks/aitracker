#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertAllowedDownloadUrl,
  assertValidChannel,
  assertValidVersion,
  metadataUrlForRelease,
  REPOSITORY,
  validateReleaseMetadata,
} from "../packages/cli/src/release-metadata.mjs";

/**
 * The three platforms `release-metadata.json` lists, down to the file each one
 * uses. Installer names are versionless, so `releases/latest/download/<name>`
 * stays valid across releases and is what the READMEs and downloads use; the
 * release also carries a versioned copy of each name, because every client
 * released before 1.0.2 accepts only
 * `releases/download/v<version>/<name>` and requires that asset to exist.
 *
 * Windows on ARM is built and attached to the release, but is deliberately not
 * listed here: a pre-1.0.2 client rejects the whole document when it carries a
 * platform key it does not know, so listing it would stop those installs from
 * updating themselves. v1.0.0 and v1.0.1 published three platforms too.
 */
const TARGET_FILES = Object.freeze([
  ["darwin-arm64", "AITracker-arm64.dmg"],
  ["darwin-x64", "AITracker-x64.dmg"],
  ["win32-x64", "AITracker-Setup-x64.exe"],
]);

/** `AITracker-1.0.2-x64.dmg` -> `AITracker-x64.dmg`. */
export function versionlessArtifactName(artifactName) {
  const match =
    /^(.*?)-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?-(arm64|x64)\.(dmg|exe)$/u.exec(
      artifactName,
    );
  if (!match) {
    throw new Error(`cannot strip the version from: ${artifactName}`);
  }
  const [, product, arch, extension] = match;
  return `${product}-${arch}.${extension}`;
}

/** `AITracker-x64.dmg` -> `AITracker-1.0.2-x64.dmg` for a given version. */
export function versionedArtifactName(version, artifactName) {
  assertValidVersion(version);
  const match = /^(.*?)-(arm64|x64)\.(dmg|exe)$/u.exec(artifactName);
  if (!match) {
    throw new Error(`cannot version the artifact name: ${artifactName}`);
  }
  const [, product, arch, extension] = match;
  return `${product}-${version}-${arch}.${extension}`;
}

export function parseReleaseMetadataArgs(argv) {
  const options = {
    releaseDir: "release",
    version: undefined,
    channel: undefined,
    repository: REPOSITORY,
    output: "release/release-metadata.json",
    checksums: "release/checksums.txt",
  };
  const valueOptions = new Set([
    "--release-dir",
    "--version",
    "--channel",
    "--repository",
    "--output",
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
  for (const [platform, versionlessName] of TARGET_FILES) {
    // The versioned copy carries the same bytes; the release uploads both.
    const name = versionedArtifactName(version, versionlessName);
    const path = join(directory, name);
    const info = await requiredFile(path);
    const bytes = await readFile(path);
    // Tag-addressed: pre-1.0.2 clients compare this URL to
    // `releases/download/v<version>/<name>` and reject anything else.
    const url = metadataUrlForRelease(version, name);
    assertAllowedDownloadUrl(url);
    artifacts[platform] = {
      name,
      url,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size: info.size,
    };
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
 * `checksums.txt` lists the name users actually download, which is the
 * versionless installer the READMEs and `releases/latest/download` serve. The
 * metadata names the versioned copy of the same bytes, so the version is
 * stripped back out here; both files are byte-identical.
 */
export function formatChecksums(metadata) {
  validateReleaseMetadata(metadata);
  return `${Object.values(metadata.artifacts)
    .map(
      (artifact) =>
        `${artifact.sha256}  ${versionlessArtifactName(artifact.name)}`,
    )
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
