import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertAllowedDownloadUrl,
  findArtifact,
  platformKey,
  validateReleaseMetadata,
} from "../src/release-metadata.mjs";

const goodUrl =
  "https://github.com/estelwalks/aitracker/releases/download/v1.0.0-beta.1/file.dmg";
const artifact = (platform, index) => ({
  name: `file-${index}.dmg`,
  url: goodUrl.replace("file.dmg", `file-${index}.dmg`),
  sha256: "a".repeat(64),
  size: 1,
});

function validMetadata() {
  return {
    schemaVersion: 1,
    appVersion: "1.0.0-beta.1",
    channel: "beta",
    repository: "estelwalks/aitracker",
    gitTag: "v1.0.0-beta.1",
    artifacts: {
      "darwin-arm64": artifact("darwin-arm64", 1),
      "darwin-x64": artifact("darwin-x64", 2),
      "win32-x64": {
        ...artifact("win32-x64", 3),
        name: "file-3.exe",
        url: goodUrl.replace("file.dmg", "file-3.exe"),
      },
    },
  };
}

test("validates the shared metadata contract and selects a platform", () => {
  const metadata = validateReleaseMetadata(validMetadata());
  assert.equal(findArtifact(metadata, "darwin", "arm64").name, "file-1.dmg");
  assert.equal(platformKey("win32", "x64"), "win32-x64");
});

test("rejects duplicate/missing platforms, invalid versions, hashes, sizes and channels", () => {
  const duplicate = validMetadata();
  duplicate.artifacts["linux-x64"] = duplicate.artifacts["darwin-arm64"];
  assert.throws(() => validateReleaseMetadata(duplicate), /unknown platform/);

  const missing = validMetadata();
  delete missing.artifacts["win32-x64"];
  assert.throws(
    () => validateReleaseMetadata(missing),
    /missing artifact platform/,
  );

  for (const mutate of [
    (value) => {
      value.appVersion = "1.0";
    },
    (value) => {
      value.version = "1.0.0-01";
    },
    (value) => {
      value.channel = "nightly";
    },
    (value) => {
      value.artifacts["darwin-arm64"].sha256 = "A".repeat(64);
    },
    (value) => {
      value.artifacts["darwin-arm64"].size = 0;
    },
    (value) => {
      value.extra = true;
    },
  ]) {
    const invalid = validMetadata();
    mutate(invalid);
    assert.throws(() => validateReleaseMetadata(invalid));
  }
});

test("accepts only the canonical GitHub Releases download host and path", () => {
  assert.doesNotThrow(() => assertAllowedDownloadUrl(goodUrl));
  for (const url of [
    "http://github.com/estelwalks/aitracker/releases/download/v1/file",
    "https://evil.example/estelwalks/aitracker/releases/download/v1/file",
    "https://github.com/estelwalks/other/releases/download/v1/file",
    `${goodUrl}?redirect=evil`,
  ]) {
    assert.throws(() => assertAllowedDownloadUrl(url));
  }
  assert.throws(() => platformKey("linux", "x64"), /Unsupported platform/);
});

test("rejects unsafe artifact names and platform-mismatched extensions", () => {
  for (const mutate of [
    (value) => {
      value.artifacts["darwin-arm64"].name = "installer;touch-pwned.dmg";
      value.artifacts["darwin-arm64"].url = goodUrl.replace(
        "file.dmg",
        "installer;touch-pwned.dmg",
      );
    },
    (value) => {
      value.artifacts["darwin-arm64"].name = "../installer.dmg";
    },
    (value) => {
      value.artifacts["darwin-arm64"].name = "installer.exe";
    },
    (value) => {
      value.artifacts["win32-x64"].name = "installer.dmg";
    },
  ]) {
    const invalid = validMetadata();
    mutate(invalid);
    assert.throws(() => validateReleaseMetadata(invalid), /name/);
  }
});
