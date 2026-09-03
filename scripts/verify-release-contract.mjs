#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  inferChannel,
  isValidVersion,
} from "../packages/cli/src/release-metadata.mjs";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const EXIT_CODES = Object.freeze({
  usage: 2,
  packageRead: 3,
  contract: 4,
  artifact: 5,
});

export const ERROR_CODES = Object.freeze({
  usage: "RC_USAGE",
  packageRead: "RC_PACKAGE_READ",
  versionInvalid: "RC_VERSION_INVALID",
  versionMismatch: "RC_VERSION_MISMATCH",
  tagInvalid: "RC_TAG_INVALID",
  tagMismatch: "RC_TAG_MISMATCH",
  channelInvalid: "RC_CHANNEL_INVALID",
  channelMismatch: "RC_CHANNEL_MISMATCH",
  platformInvalid: "RC_PLATFORM_INVALID",
  artifactDirectory: "RC_ARTIFACT_DIRECTORY",
  artifactMissing: "RC_ARTIFACT_MISSING",
});

export const RELEASE_PLATFORMS = Object.freeze([
  "darwin-arm64",
  "darwin-x64",
  "win32-x64",
]);

const VALUE_OPTIONS = new Set([
  "--tag",
  "--channel",
  "--release-dir",
  "--platform",
]);

export class ReleaseContractError extends Error {
  constructor(message, errorCode, exitCode) {
    super(message);
    this.name = "ReleaseContractError";
    this.errorCode = errorCode;
    this.exitCode = exitCode;
  }
}

function usageError(message) {
  return new ReleaseContractError(message, ERROR_CODES.usage, EXIT_CODES.usage);
}

function contractError(message, errorCode) {
  return new ReleaseContractError(message, errorCode, EXIT_CODES.contract);
}

function artifactError(message, errorCode) {
  return new ReleaseContractError(message, errorCode, EXIT_CODES.artifact);
}

export function parseReleaseContractArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [name, inlineValue] = arg.split("=", 2);
    if (!VALUE_OPTIONS.has(name)) {
      throw usageError(`unknown option: ${arg}`);
    }
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--")) {
      throw usageError(`${name} requires a value`);
    }
    const key = name
      .slice(2)
      .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    options[key] = value;
  }

  if (
    options.channel !== undefined &&
    !["stable", "beta"].includes(options.channel)
  ) {
    throw new ReleaseContractError(
      `--channel must be stable or beta, received ${options.channel}`,
      ERROR_CODES.channelInvalid,
      EXIT_CODES.usage,
    );
  }
  if (
    options.platform !== undefined &&
    !RELEASE_PLATFORMS.includes(options.platform)
  ) {
    throw new ReleaseContractError(
      `--platform must be one of ${RELEASE_PLATFORMS.join(", ")}, received ${options.platform}`,
      ERROR_CODES.platformInvalid,
      EXIT_CODES.usage,
    );
  }
  if (options.tag !== undefined && !/^v[^/]+$/.test(options.tag)) {
    throw new ReleaseContractError(
      `--tag must use the vX.Y.Z form, received ${options.tag}`,
      ERROR_CODES.tagInvalid,
      EXIT_CODES.usage,
    );
  }
  return options;
}

export function expectedReleaseArtifacts(version, platform) {
  const artifacts = [
    Object.freeze({
      platform: "darwin-arm64",
      name: `AITracker-${version}-arm64.dmg`,
    }),
    Object.freeze({
      platform: "darwin-x64",
      name: `AITracker-${version}-x64.dmg`,
    }),
    Object.freeze({
      platform: "win32-x64",
      name: `AITracker-Setup-${version}-x64.exe`,
    }),
  ];
  return Object.freeze(
    platform === undefined
      ? artifacts
      : artifacts.filter((artifact) => artifact.platform === platform),
  );
}

export function validateReleaseContract({
  rootPackage,
  cliPackage,
  tag,
  channel,
  platform,
}) {
  const rootVersion = rootPackage?.version;
  const cliVersion = cliPackage?.version;

  if (!isValidVersion(rootVersion)) {
    throw contractError(
      `root package.json version must be a strict semantic version (x.y.z): ${String(rootVersion)}`,
      ERROR_CODES.versionInvalid,
    );
  }
  if (!isValidVersion(cliVersion)) {
    throw contractError(
      `packages/cli/package.json version must be a strict semantic version (x.y.z): ${String(cliVersion)}`,
      ERROR_CODES.versionInvalid,
    );
  }
  if (rootVersion !== cliVersion) {
    throw contractError(
      `package versions must match: root=${rootVersion}, packages/cli=${cliVersion}`,
      ERROR_CODES.versionMismatch,
    );
  }

  const version = rootVersion;
  const inferredChannel = inferChannel(version);
  if (platform !== undefined && !RELEASE_PLATFORMS.includes(platform)) {
    throw contractError(
      `platform must be one of ${RELEASE_PLATFORMS.join(", ")}, received ${platform}`,
      ERROR_CODES.platformInvalid,
    );
  }
  if (tag !== undefined && tag !== `v${version}`) {
    throw contractError(
      `tag must match package version: expected v${version}, received ${tag}`,
      ERROR_CODES.tagMismatch,
    );
  }
  if (channel !== undefined && channel !== inferredChannel) {
    throw contractError(
      `channel must match prerelease status: version ${version} is ${inferredChannel}, received ${channel}`,
      ERROR_CODES.channelMismatch,
    );
  }

  return {
    version,
    channel: channel ?? inferredChannel,
    tag: tag ?? `v${version}`,
    platform,
    artifacts: expectedReleaseArtifacts(version, platform),
  };
}

async function readPackageJson(path, label) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new ReleaseContractError(
      `unable to read ${label}: ${error instanceof Error ? error.message : String(error)}`,
      ERROR_CODES.packageRead,
      EXIT_CODES.packageRead,
    );
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ReleaseContractError(
      `${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      ERROR_CODES.packageRead,
      EXIT_CODES.packageRead,
    );
  }
}

async function verifyReleaseArtifacts(releaseDir, artifacts) {
  let directoryInfo;
  try {
    directoryInfo = await stat(releaseDir);
  } catch (error) {
    throw artifactError(
      `release directory is not available: ${releaseDir} (${error instanceof Error ? error.message : String(error)})`,
      ERROR_CODES.artifactDirectory,
    );
  }
  if (!directoryInfo.isDirectory()) {
    throw artifactError(
      `release path is not a directory: ${releaseDir}`,
      ERROR_CODES.artifactDirectory,
    );
  }

  for (const artifact of artifacts) {
    const path = join(releaseDir, artifact.name);
    try {
      const info = await stat(path);
      if (!info.isFile()) throw new Error("path is not a file");
    } catch (error) {
      throw artifactError(
        `missing expected release artifact for ${artifact.platform}: ${path} (${error instanceof Error ? error.message : String(error)})`,
        ERROR_CODES.artifactMissing,
      );
    }
  }
}

export async function verifyReleaseContract({
  rootDir = PROJECT_ROOT,
  tag,
  channel,
  platform,
  releaseDir,
  cwd = process.cwd(),
} = {}) {
  const rootPackage = await readPackageJson(
    join(rootDir, "package.json"),
    "root package.json",
  );
  const cliPackage = await readPackageJson(
    join(rootDir, "packages/cli/package.json"),
    "packages/cli/package.json",
  );
  const contract = validateReleaseContract({
    rootPackage,
    cliPackage,
    tag,
    channel,
    platform,
  });

  if (releaseDir !== undefined) {
    const resolvedReleaseDir = resolve(cwd, releaseDir);
    await verifyReleaseArtifacts(resolvedReleaseDir, contract.artifacts);
    return { ...contract, releaseDir: resolvedReleaseDir };
  }
  return contract;
}

function printSuccess(contract) {
  console.log("verify-release-contract: PASS");
  console.log(`version: ${contract.version}`);
  console.log(`channel: ${contract.channel}`);
  console.log(`tag: ${contract.tag}`);
  console.log("expected artifacts:");
  for (const artifact of contract.artifacts) {
    console.log(`- ${artifact.platform}: ${artifact.name}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseReleaseContractArgs(process.argv.slice(2));
    printSuccess(await verifyReleaseContract(options));
  } catch (error) {
    const errorCode = error?.errorCode ?? "RC_UNEXPECTED";
    const exitCode = error?.exitCode ?? 1;
    console.error(
      `verify-release-contract: ERROR [${errorCode}] (exit ${exitCode}): ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = exitCode;
  }
}
