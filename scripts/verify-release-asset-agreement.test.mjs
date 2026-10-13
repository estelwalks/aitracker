import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  inspectRelease,
  verifyReleaseAssetAgreement,
} from "./verify-release-asset-agreement.mjs";
import { EXPECTED_ARTIFACT_NAMES } from "./verify-release-artifact-names.mjs";

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "verify-release-asset-agreement.mjs",
);

const METADATA_NAME = "release-metadata.json";

// A deliberately self-contained pre-rename release: the four macOS/Windows
// installers under their old names. It does not mirror
// EXPECTED_ARTIFACT_NAMES — the point is that this stale release is missing
// whatever the config now renders, including the Linux AppImage.
const PLATFORM_KEYS = Object.freeze([
  "darwin-arm64",
  "darwin-x64",
  "win32-arm64",
  "win32-x64",
]);

/** The four names a rename replaced, aligned with PLATFORM_KEYS. */
const PREVIOUS_NAMES = Object.freeze([
  "AITracker-arm64.dmg",
  "AITracker-x64.dmg",
  "AITracker-Setup-arm64.exe",
  "AITracker-Setup-x64.exe",
]);

function assetsOf(names) {
  return [
    ...names.map((name) => ({
      name,
      browser_download_url: `https://github.com/estelwalks/aitracker/releases/download/v1.0.5/${name}`,
    })),
    { name: METADATA_NAME, browser_download_url: "https://example.test/x" },
    { name: "checksums.txt", browser_download_url: "https://example.test/y" },
  ];
}

function metadataOf(names) {
  return {
    schemaVersion: 1,
    appVersion: "1.0.5",
    channel: "stable",
    repository: "estelwalks/aitracker",
    gitTag: "v1.0.5",
    artifacts: Object.fromEntries(
      PLATFORM_KEYS.map((key, index) => [
        key,
        {
          name: names[index],
          url: `https://github.com/estelwalks/aitracker/releases/latest/download/${names[index]}`,
          sha256: "a".repeat(64),
          size: 1,
        },
      ]),
    ),
  };
}

test("a release whose assets and metadata carry the same names passes", () => {
  assert.deepEqual(
    inspectRelease({
      assets: assetsOf(EXPECTED_ARTIFACT_NAMES),
      metadata: metadataOf(EXPECTED_ARTIFACT_NAMES),
    }),
    [],
  );
});

test("the previous version's names pass as long as both sides agree", () => {
  // The guard is about agreement, not about one particular name: a release that
  // publishes and records the older names is internally consistent. It is only
  // the mixed state below that breaks updating.
  assert.deepEqual(
    inspectRelease({
      assets: assetsOf(PREVIOUS_NAMES),
      metadata: metadataOf(PREVIOUS_NAMES),
      expectedNames: PREVIOUS_NAMES,
    }),
    [],
  );
});

test("a renamed asset set with metadata still recording the old names fails", () => {
  // The half-rename: this is what makes every 1.0.3+ install report a download
  // failure, because the client requires the metadata name to be an asset of
  // the same release.
  const problems = inspectRelease({
    assets: assetsOf(EXPECTED_ARTIFACT_NAMES),
    metadata: metadataOf(PREVIOUS_NAMES),
  });
  // One problem per platform the metadata names an unpublished file for, each
  // naming the file that platform was renamed to.
  assert.equal(problems.length, PREVIOUS_NAMES.length);
  assert.ok(
    problems.some((problem) =>
      /names AITracker-x64\.dmg for darwin-x64, which this release does not publish/u.test(
        problem,
      ),
    ),
    problems.join("\n"),
  );
  assert.ok(
    problems.every(
      (problem) => !/does not publish AITracker-macOS/u.test(problem),
    ),
    "the published names must not be reported as missing",
  );
});

test("assets still carrying the old names while the config renders new ones fails", () => {
  // The other half of a rename: the packaging config was updated but the
  // release was assembled from a stale build.
  const problems = inspectRelease({
    assets: assetsOf(PREVIOUS_NAMES),
    metadata: metadataOf(PREVIOUS_NAMES),
  });
  // One problem per name the config renders that this stale release lacks: the
  // four old macOS/Windows names no longer match, and the Linux AppImage this
  // pre-Linux build never produced is missing entirely — so the stale release
  // is reported against every name in EXPECTED_ARTIFACT_NAMES.
  assert.equal(problems.length, EXPECTED_ARTIFACT_NAMES.length);
  assert.ok(
    problems.every((problem) =>
      /the release does not publish AITracker-(macOS|Windows|Linux)/u.test(
        problem,
      ),
    ),
    problems.join("\n"),
  );
});

test("metadata naming an asset the release does not attach fails", () => {
  const problems = inspectRelease({
    assets: assetsOf(EXPECTED_ARTIFACT_NAMES),
    metadata: metadataOf([
      ...EXPECTED_ARTIFACT_NAMES.slice(0, 3),
      "AITracker-Windows-x64-extra.exe",
    ]),
  });
  assert.ok(
    problems.some((problem) =>
      /names AITracker-Windows-x64-extra\.exe for win32-x64/u.test(problem),
    ),
    problems.join("\n"),
  );
});

test("a missing release-metadata.json asset is reported", () => {
  const problems = inspectRelease({
    assets: assetsOf(EXPECTED_ARTIFACT_NAMES).filter(
      (asset) => asset.name !== METADATA_NAME,
    ),
    metadata: metadataOf(EXPECTED_ARTIFACT_NAMES),
  });
  assert.ok(
    problems.some((problem) =>
      /does not publish release-metadata\.json/u.test(problem),
    ),
    problems.join("\n"),
  );
});

test("the CLI reads the assembled release and exits non-zero on drift", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-asset-agreement-"));
  const assetsPath = join(root, "assets.json");
  const metadataPath = join(root, "release-metadata.json");
  try {
    await writeFile(
      assetsPath,
      JSON.stringify(assetsOf(EXPECTED_ARTIFACT_NAMES)),
      "utf8",
    );
    await writeFile(
      metadataPath,
      JSON.stringify(metadataOf(PREVIOUS_NAMES)),
      "utf8",
    );
    assert.ok(
      (await verifyReleaseAssetAgreement({ assetsPath, metadataPath })).length >
        0,
    );

    const failing = spawnSync(
      process.execPath,
      [SCRIPT, "--assets", assetsPath, "--metadata", metadataPath],
      { encoding: "utf8" },
    );
    assert.equal(failing.status, 1);
    assert.match(failing.stderr, /verify-release-asset-agreement: FAIL/u);

    await writeFile(
      metadataPath,
      JSON.stringify(metadataOf(EXPECTED_ARTIFACT_NAMES)),
      "utf8",
    );
    const passing = spawnSync(
      process.execPath,
      [SCRIPT, "--assets", assetsPath, "--metadata", metadataPath],
      { encoding: "utf8" },
    );
    assert.equal(passing.status, 0, passing.stderr);
    assert.match(passing.stdout, /verify-release-asset-agreement: PASS/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the shipped metadata generator writes names this guard accepts", async () => {
  // End to end on the local side: build release-metadata.json from a release
  // directory holding exactly the four names the packaging step renders, then
  // check it against those same four asset names.
  const { buildReleaseMetadata } = await import("./release-metadata.mjs");
  const root = await mkdtemp(join(tmpdir(), "aitracker-agreement-dir-"));
  try {
    for (const [index, name] of EXPECTED_ARTIFACT_NAMES.entries()) {
      await writeFile(join(root, name), Buffer.from(`artifact-${index}`));
    }
    const metadata = await buildReleaseMetadata({
      releaseDir: root,
      version: "1.0.5",
      channel: "stable",
    });
    assert.deepEqual(
      inspectRelease({
        assets: assetsOf(EXPECTED_ARTIFACT_NAMES),
        metadata,
      }),
      [],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
