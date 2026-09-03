import assert from "node:assert/strict";
import test from "node:test";

import { APP_VERSION, STORAGE_KEY_PREFIX } from "./app-config.ts";
import {
  readCachedVersionResult,
  VERSION_CHECK_TTL_MS,
} from "./version-check.ts";
import {
  compareVersions,
  selectLatestGitHubRelease,
  selectReleaseAsset,
} from "./version-check.server.ts";

const key = (suffix: string) => `${STORAGE_KEY_PREFIX}update.${suffix}`;
const checkedAt = "2026-08-19T00:00:00.000Z";

function cache(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    [key("hasUpdate")]: "true",
    [key("latestVersion")]: "3.1.0",
    [key("changelog")]: "notes",
    [key("releaseUrl")]: "https://example.invalid/release",
    [key("checkedAt")]: checkedAt,
    [key("currentVersion")]: APP_VERSION,
    [key("status")]: "newer",
    ...overrides,
  };
  return (name: string) => values[name] ?? null;
}

test("rehydrates a complete version result within the 24 hour TTL", () => {
  const result = readCachedVersionResult(
    cache(),
    Date.parse(checkedAt) + VERSION_CHECK_TTL_MS - 1,
  );
  assert.equal(result?.status, "newer");
  assert.equal(result?.latestVersion, "3.1.0");
});

test("rejects stale, incomplete, and previous-app-version cache entries", () => {
  assert.equal(
    readCachedVersionResult(
      cache(),
      Date.parse(checkedAt) + VERSION_CHECK_TTL_MS + 1,
    ),
    null,
  );
  assert.equal(
    readCachedVersionResult(
      cache({ [key("latestVersion")]: "" }),
      Date.parse(checkedAt),
    ),
    null,
  );
  assert.equal(
    readCachedVersionResult(
      cache({ [key("currentVersion")]: "2.9.0" }),
      Date.parse(checkedAt),
    ),
    null,
  );
});

test("rehydrates an unknown result so offline mounts honor the TTL", () => {
  const result = readCachedVersionResult(
    cache({
      [key("status")]: "unknown",
      [key("hasUpdate")]: "false",
      [key("latestVersion")]: "",
      [key("changelog")]: "",
      [key("releaseUrl")]: "",
    }),
    Date.parse(checkedAt) + 60_000,
  );
  assert.deepEqual(result, {
    status: "unknown",
    currentVersion: APP_VERSION,
    latestVersion: null,
    changelog: null,
    releaseUrl: null,
    downloadUrl: null,
    assetName: null,
    checkedAt,
  });
});

test("compareVersions sorts prereleases before stable releases", () => {
  assert.ok(compareVersions("1.0.0", "1.0.0-beta.1") > 0);
  assert.ok(compareVersions("1.0.0-beta.2", "1.0.0-beta.1") > 0);
  assert.ok(compareVersions("1.0.0-beta.1", "1.0.0") < 0);
});

test("compareVersions ignores build metadata", () => {
  assert.equal(compareVersions("v1.0.0+build.1", "1.0.0+build.2"), 0);
});

test("selects the highest GitHub tag and matching installer asset", () => {
  const releases = [
    { tag_name: "v1.1.0", draft: false },
    { tag_name: "v1.2.0-beta.1", draft: false },
    { tag_name: "v1.0.0", draft: true },
  ];
  assert.equal(selectLatestGitHubRelease(releases)?.tag_name, "v1.2.0-beta.1");

  assert.deepEqual(
    selectReleaseAsset(
      [
        {
          name: "AITracker-1.2.0-beta.1-arm64.dmg",
          browser_download_url:
            "https://github.com/estelwalks/aitracker/releases/download/v1.2.0-beta.1/AITracker-1.2.0-beta.1-arm64.dmg",
        },
        {
          name: "AITracker-1.2.0-beta.1-x64.dmg",
          browser_download_url:
            "https://github.com/estelwalks/aitracker/releases/download/v1.2.0-beta.1/AITracker-1.2.0-beta.1-x64.dmg",
        },
      ],
      "darwin",
      "x64",
    ),
    {
      name: "AITracker-1.2.0-beta.1-x64.dmg",
      url: "https://github.com/estelwalks/aitracker/releases/download/v1.2.0-beta.1/AITracker-1.2.0-beta.1-x64.dmg",
    },
  );
});
