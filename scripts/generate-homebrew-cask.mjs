import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertAllowedDownloadUrl,
  assertValidChannel,
  findArtifact,
  REPOSITORY,
  validateReleaseMetadata,
} from "../packages/cli/src/release-metadata.mjs";

const DEFAULT_REPOSITORY = REPOSITORY;
const TOKENS = Object.freeze({ stable: "aitracker", beta: "aitracker-beta" });
const CHANNEL_DETAILS = Object.freeze({
  stable: Object.freeze({
    name: "AITracker",
    desc: "Local-first AI development asset dashboard",
  }),
  beta: Object.freeze({
    name: "AITracker Beta",
    desc: "Pre-release local-first AI development asset dashboard",
  }),
});
const REQUIRED_DARWIN_ARTIFACTS = Object.freeze([
  ["arm", "darwin-arm64", "arm64"],
  ["intel", "darwin-x64", "x64"],
]);
const SAFE_ARTIFACT_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/u;

function fail(message) {
  throw new TypeError(`Invalid release metadata: ${message}`);
}

function validateArtifact(artifact, { key, expectedName, version }) {
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    fail(`artifacts.${key} must be an object`);
  }
  const { name, url, sha256, size } = artifact;
  if (typeof name !== "string" || !SAFE_ARTIFACT_NAME.test(name)) {
    fail(`artifacts.${key}.name must be a safe file name`);
  }
  if (expectedName && name !== expectedName) {
    fail(`artifacts.${key}.name must be ${expectedName}`);
  }
  try {
    assertAllowedDownloadUrl(url, `artifacts.${key}.url`);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  if (
    url !==
    `https://github.com/${DEFAULT_REPOSITORY}/releases/download/v${version}/${name}`
  ) {
    fail(`artifacts.${key}.url must match appVersion and name`);
  }
}

/**
 * Validate the release-metadata.json contract consumed by channel adapters.
 * The returned object is the original metadata after all fields used by the
 * renderer have been checked; no values are calculated from local artifacts.
 */
export function validateMetadata(metadata, { channel } = {}) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    fail("root must be an object");
  }
  try {
    assertValidChannel(channel);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  if (metadata.channel !== channel) {
    fail(`channel must match --channel (${channel})`);
  }
  try {
    validateReleaseMetadata(metadata);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  for (const [, , arch] of REQUIRED_DARWIN_ARTIFACTS) {
    validateArtifact(findArtifact(metadata, "darwin", arch), {
      key: `darwin-${arch}`,
      expectedName: `AITracker-${metadata.appVersion}-${arch}.dmg`,
      version: metadata.appVersion,
    });
  }
  return metadata;
}

function rubyString(value) {
  return JSON.stringify(value);
}

/** Render one complete Cask from already validated metadata. */
export function renderCask(metadata, { token, channel } = {}) {
  validateMetadata(metadata, { channel });
  if (token !== TOKENS[channel]) {
    fail(`token must be ${TOKENS[channel]} for the ${channel} channel`);
  }

  const arm = findArtifact(metadata, "darwin", "arm64");
  const intel = findArtifact(metadata, "darwin", "x64");
  const homepage = `https://github.com/${DEFAULT_REPOSITORY}`;
  const { name, desc } = CHANNEL_DETAILS[channel];

  return (
    [
      `cask ${rubyString(token)} do`,
      "  download_url = on_arch_conditional(",
      `    arm:   ${rubyString(arm.url)},`,
      `    intel: ${rubyString(intel.url)},`,
      "  )",
      "",
      `  version ${rubyString(metadata.appVersion)}`,
      `  sha256 arm:   ${rubyString(arm.sha256)},`,
      `         intel: ${rubyString(intel.sha256)}`,
      "",
      "  url download_url",
      `  name ${rubyString(name)}`,
      `  desc ${rubyString(desc)}`,
      `  homepage ${rubyString(homepage)}`,
      "",
      "  depends_on macos: :big_sur",
      "",
      `  app ${rubyString("AITracker.app")}`,
      "",
      `  uninstall quit: ${rubyString("com.aitracker.desktop")}`,
      "",
      "  zap trash: [",
      `    ${rubyString("~/.aitracker")},`,
      `    ${rubyString("~/Library/Application Support/AITracker")},`,
      `    ${rubyString("~/Library/Preferences/com.aitracker.desktop.plist")},`,
      `    ${rubyString("~/Library/Saved Application State/com.aitracker.desktop.savedState")},`,
      "  ]",
      "end",
    ].join("\n") + "\n"
  );
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const match = /^--(metadata|output|token|channel)(?:=(.*))?$/u.exec(
      argument,
    );
    if (!match) throw new Error(`Unknown argument: ${argument}`);
    const [, key, inlineValue] = match;
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    if (options[key] !== undefined) throw new Error(`Duplicate --${key}`);
    options[key] = value;
  }

  for (const key of ["metadata", "output", "token", "channel"]) {
    if (!options[key]) throw new Error(`Missing required --${key}`);
  }
  return options;
}

export async function generateCask({
  metadataPath,
  outputPath,
  token,
  channel,
}) {
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  const rendered = renderCask(metadata, { token, channel });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, rendered, "utf8");
  return rendered;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await generateCask({
    metadataPath: resolve(options.metadata),
    outputPath: resolve(options.output),
    token: options.token,
    channel: options.channel,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
