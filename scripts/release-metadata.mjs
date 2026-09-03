#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  assertAllowedDownloadUrl,
  assertValidChannel,
  assertValidVersion,
  metadataUrlForRelease,
  REPOSITORY,
  validateReleaseMetadata,
} from "../packages/cli/src/release-metadata.mjs";

const TARGET_FILES = Object.freeze([
  ["darwin-arm64", (version) => `AITracker-${version}-arm64.dmg`],
  ["darwin-x64", (version) => `AITracker-${version}-x64.dmg`],
  ["win32-x64", (version) => `AITracker-Setup-${version}-x64.exe`],
]);

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
  for (const [platform, filenameForVersion] of TARGET_FILES) {
    const name = filenameForVersion(version);
    const path = join(directory, name);
    const info = await requiredFile(path);
    const bytes = await readFile(path);
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
  await writeTextOutput(options.checksums, formatChecksums(metadata));
  return metadata;
}

if (import.meta.url === `file://${process.argv[1]}`) {
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
