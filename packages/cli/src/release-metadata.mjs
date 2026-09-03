import { URL } from "node:url";

export const REPOSITORY = "estelwalks/aitracker";
export const RELEASE_API_URL = `https://api.github.com/repos/${REPOSITORY}/releases?per_page=100`;
export const RELEASE_DOWNLOAD_BASE_URL = `https://github.com/${REPOSITORY}/releases/download/`;
const RELEASE_REDIRECT_HOSTS = new Set([
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com",
]);
export const SUPPORTED_PLATFORMS = Object.freeze([
  "darwin-arm64",
  "darwin-x64",
  "win32-x64",
]);

const VERSION_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const GIT_COMMIT_PATTERN = /^[0-9a-fA-F]{40}$/;
const SAFE_ARTIFACT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/u;

export function isValidVersion(version) {
  return typeof version === "string" && VERSION_PATTERN.test(version);
}

export function assertValidVersion(version, label = "appVersion") {
  if (!isValidVersion(version)) {
    throw new Error(`${label} must be a strict semantic version (x.y.z)`);
  }
  return version;
}

export function inferChannel(version) {
  assertValidVersion(version);
  return version.includes("-") ? "beta" : "stable";
}

export function assertValidChannel(channel) {
  if (channel !== "stable" && channel !== "beta") {
    throw new Error("channel must be stable or beta");
  }
  return channel;
}

export function platformKey(platform, arch) {
  const key = `${platform}-${arch}`;
  if (!SUPPORTED_PLATFORMS.includes(key)) {
    throw new Error(
      `Unsupported platform/architecture: ${platform}/${arch}. ` +
        "Supported targets are macOS arm64, macOS x64, and Windows x64.",
    );
  }
  return key;
}

export function assertAllowedDownloadUrl(value, label = "url") {
  if (typeof value !== "string") {
    throw new Error(`${label} must be an HTTPS GitHub Releases download URL`);
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      `${label} must be a valid HTTPS GitHub Releases download URL`,
    );
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "github.com" ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !value.startsWith(RELEASE_DOWNLOAD_BASE_URL) ||
    !/^\/estelwalks\/aitracker\/releases\/download\/[^/]+\/[^/]+$/.test(
      parsed.pathname,
    )
  ) {
    throw new Error(`${label} must be under ${RELEASE_DOWNLOAD_BASE_URL}`);
  }

  return value;
}

function assertSecureResponseUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid HTTPS URL`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  ) {
    throw new Error(`${label} must be an HTTPS URL without credentials`);
  }
  return parsed;
}

export function assertAllowedApiResponseUrl(value, label = "response URL") {
  const parsed = assertSecureResponseUrl(value, label);
  if (parsed.hostname !== "api.github.com") {
    throw new Error(`${label} must resolve to api.github.com`);
  }
  return value;
}

export function assertAllowedReleaseResponseUrl(value, label = "response URL") {
  const parsed = assertSecureResponseUrl(value, label);
  if (parsed.hostname === "github.com") {
    assertAllowedDownloadUrl(value, label);
    return value;
  }
  if (!RELEASE_REDIRECT_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `${label} must resolve to github.com, release-assets.githubusercontent.com, or objects.githubusercontent.com`,
    );
  }
  return value;
}

function assertArtifact(artifact, key, appVersion) {
  const prefix = `artifacts.${key}`;
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    throw new Error(`${prefix} must be an object`);
  }
  const allowedKeys = new Set(["name", "url", "sha256", "size"]);
  for (const field of Object.keys(artifact)) {
    if (!allowedKeys.has(field)) {
      throw new Error(`${prefix} has unknown field: ${field}`);
    }
  }
  const expectedExtension = key === "win32-x64" ? ".exe" : ".dmg";
  if (
    typeof artifact.name !== "string" ||
    artifact.name.length === 0 ||
    artifact.name.length > 255 ||
    !SAFE_ARTIFACT_NAME_PATTERN.test(artifact.name)
  ) {
    throw new Error(
      `${prefix}.name must be a safe file name using only ASCII letters, numbers, ., _, +, and -`,
    );
  }
  if (!artifact.name.endsWith(expectedExtension)) {
    throw new Error(
      `${prefix}.name must use the ${expectedExtension} extension for ${key}`,
    );
  }
  const expectedUrl = metadataUrlForRelease(appVersion, artifact.name);
  assertAllowedDownloadUrl(artifact.url, `${prefix}.url`);
  if (artifact.url !== expectedUrl) {
    throw new Error(`${prefix}.url must match appVersion and name`);
  }
  if (
    typeof artifact.sha256 !== "string" ||
    !SHA256_PATTERN.test(artifact.sha256)
  ) {
    throw new Error(
      `${prefix}.sha256 must be 64 lowercase hexadecimal characters`,
    );
  }
  if (
    !Number.isInteger(artifact.size) ||
    !Number.isSafeInteger(artifact.size) ||
    artifact.size <= 0
  ) {
    throw new Error(`${prefix}.size must be a positive integer`);
  }
}

function assertOptionalMetadataFields(metadata) {
  if (
    metadata.gitCommit !== undefined &&
    !GIT_COMMIT_PATTERN.test(metadata.gitCommit)
  ) {
    throw new Error("gitCommit must be a 40-character hexadecimal SHA");
  }
  if (metadata.publishedAt !== undefined) {
    if (
      typeof metadata.publishedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
        metadata.publishedAt,
      ) ||
      !Number.isFinite(Date.parse(metadata.publishedAt))
    ) {
      throw new Error("publishedAt must be an ISO-8601 date-time");
    }
  }
}

export function validateReleaseMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("release metadata must be an object");
  }
  const allowedKeys = new Set([
    "schemaVersion",
    "appVersion",
    "channel",
    "repository",
    "gitTag",
    "gitCommit",
    "publishedAt",
    "artifacts",
  ]);
  for (const key of Object.keys(metadata)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`release metadata has unknown field: ${key}`);
    }
  }
  if (metadata.schemaVersion !== 1) {
    throw new Error("schemaVersion must be 1");
  }
  assertValidVersion(metadata.appVersion);
  assertValidChannel(metadata.channel);
  if (metadata.channel !== inferChannel(metadata.appVersion)) {
    throw new Error("channel must match the appVersion prerelease status");
  }
  if (metadata.repository !== REPOSITORY) {
    throw new Error(`repository must be ${REPOSITORY}`);
  }
  if (metadata.gitTag !== `v${metadata.appVersion}`) {
    throw new Error("gitTag must be v<appVersion>");
  }
  assertOptionalMetadataFields(metadata);
  if (
    !metadata.artifacts ||
    typeof metadata.artifacts !== "object" ||
    Array.isArray(metadata.artifacts)
  ) {
    throw new Error("artifacts must be an object keyed by platform");
  }
  const artifactKeys = Object.keys(metadata.artifacts);
  for (const key of artifactKeys) {
    if (!SUPPORTED_PLATFORMS.includes(key)) {
      throw new Error(`artifacts has unknown platform: ${key}`);
    }
    assertArtifact(metadata.artifacts[key], key, metadata.appVersion);
  }
  for (const key of SUPPORTED_PLATFORMS) {
    if (!Object.prototype.hasOwnProperty.call(metadata.artifacts, key)) {
      throw new Error(`missing artifact platform: ${key}`);
    }
  }
  return metadata;
}

export function findArtifact(metadata, platform, arch) {
  const key = platformKey(platform, arch);
  const artifact = metadata.artifacts[key];
  if (!artifact) {
    throw new Error(`release metadata has no artifact for ${key}`);
  }
  return artifact;
}

export function metadataUrlForRelease(version, name) {
  assertValidVersion(version);
  if (typeof name !== "string" || name.length === 0 || /[/\\?#]/.test(name)) {
    throw new Error("release asset name must be a file name");
  }
  return `${RELEASE_DOWNLOAD_BASE_URL}v${version}/${name}`;
}
