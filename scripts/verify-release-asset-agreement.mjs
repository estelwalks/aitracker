#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EXPECTED_ARTIFACT_NAMES } from "./verify-release-artifact-names.mjs";

const METADATA_NAME = "release-metadata.json";

/**
 * The one invariant a rename must not break.
 *
 * A desktop install selects its installer by file extension and architecture —
 * never by name — and then requires the name recorded in that release's
 * `release-metadata.json` to be an asset of that same release. Asset names and
 * metadata therefore have to move together: publishing the new names while the
 * metadata still names the old ones turns every in-app update on 1.0.3 and
 * later into a download failure.
 *
 * `scripts/release-metadata.mjs` builds the record from the local files, so a
 * wrong name there is possible only if the two drifted apart. This gate runs
 * on the assembled release — the exact asset list the draft release would
 * publish and the exact `release-metadata.json` — so the drift is caught
 * before a maintainer publishes the draft.
 *
 * `expectedNames` defaults to the names the packaging config currently renders;
 * a rename moves that list, and every other module with it, in one release.
 */
export function inspectRelease({
  assets,
  metadata,
  expectedNames = EXPECTED_ARTIFACT_NAMES,
}) {
  const problems = [];
  const names = new Set(
    assets
      .map((asset) => (typeof asset === "string" ? asset : asset?.name))
      .filter((name) => typeof name === "string" && name.length > 0),
  );

  for (const name of expectedNames) {
    if (!names.has(name)) {
      problems.push(
        `the release does not publish ${name}; the packaging config and the release scripts name it`,
      );
    }
  }
  if (!names.has(METADATA_NAME)) {
    problems.push(`the release does not publish ${METADATA_NAME}`);
  }

  const artifacts = metadata?.artifacts;
  if (
    typeof artifacts !== "object" ||
    artifacts === null ||
    Array.isArray(artifacts)
  ) {
    problems.push(`${METADATA_NAME} must carry an artifacts object`);
    return problems;
  }

  for (const [platform, record] of Object.entries(artifacts)) {
    const name = record?.name;
    if (typeof name !== "string" || name.length === 0) {
      problems.push(`${METADATA_NAME} artifacts.${platform} must name a file`);
      continue;
    }
    if (!names.has(name)) {
      problems.push(
        `${METADATA_NAME} names ${name} for ${platform}, which this release does not publish — ` +
          `every 1.0.3+ install rejects the whole document and reports a download failure`,
      );
    }
  }
  return problems;
}

export async function readReleaseAssets({ assetsPath }) {
  if (assetsPath === "-") {
    return JSON.parse(await readStdin());
  }
  return JSON.parse(await readFile(assetsPath, "utf8"));
}

function readStdin() {
  return new Promise((resolveStdin, reject) => {
    let text = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      text += chunk;
    });
    process.stdin.on("end", () => resolveStdin(text));
    process.stdin.on("error", reject);
  });
}

export async function verifyReleaseAssetAgreement({
  assetsPath,
  metadataPath,
} = {}) {
  const assets = await readReleaseAssets({ assetsPath });
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  return inspectRelease({ assets, metadata });
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const [name, inlineValue] = argument.split("=", 2);
    if (name !== "--assets" && name !== "--metadata") {
      throw new Error(`unknown option: ${argument}`);
    }
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--")) {
      throw new Error(`${name} requires a value`);
    }
    options[name.slice(2)] = value;
  }
  for (const key of ["assets", "metadata"]) {
    if (!options[key]) throw new Error(`missing required --${key}`);
  }
  return options;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const problems = await verifyReleaseAssetAgreement({
      assetsPath: options.assets,
      metadataPath: resolve(options.metadata),
    });
    if (problems.length > 0) {
      for (const problem of problems) console.error(problem);
      console.error(
        `verify-release-asset-agreement: FAIL (${problems.length} problem${problems.length === 1 ? "" : "s"})`,
      );
      process.exitCode = 1;
    } else {
      console.log(
        "verify-release-asset-agreement: PASS (release assets and release-metadata.json agree)",
      );
    }
  } catch (error) {
    console.error(
      `verify-release-asset-agreement: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
