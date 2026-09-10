import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { UpdateManager, selectUpdateAsset } from "./update-manager.ts";

// Fixtures are tag-addressed: asset names carry no version, and the tag is
// what identifies the release a name resolves to.
const releaseUrl =
  "https://github.com/estelwalks/aitracker/releases/download/v2.0.0/AITracker-x64.dmg";
const metadataUrl =
  "https://github.com/estelwalks/aitracker/releases/download/v2.0.0/release-metadata.json";
const downloadedBytes = new Uint8Array([1, 2, 3]);
const downloadedSha256 =
  "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81";

function response(body: unknown, init?: ResponseInit): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

test("selectUpdateAsset chooses the current architecture and rejects foreign assets", () => {
  const assets = [
    {
      name: "AITracker-arm64.dmg",
      browser_download_url:
        "https://github.com/estelwalks/aitracker/releases/download/v2.0.0/AITracker-arm64.dmg",
    },
    { name: "AITracker-x64.dmg", browser_download_url: releaseUrl },
    {
      name: "AITracker-x64.dmg.sig",
      browser_download_url: `${releaseUrl}.sig`,
    },
  ];
  assert.deepEqual(selectUpdateAsset(assets, "darwin", "x64"), {
    name: "AITracker-x64.dmg",
    url: releaseUrl,
  });
  assert.equal(
    selectUpdateAsset(
      [
        {
          name: "AITracker-arm64.dmg",
          browser_download_url:
            "https://github.com/estelwalks/aitracker/releases/download/v2.0.0/AITracker-arm64.dmg",
        },
      ],
      "darwin",
      "x64",
    ),
    null,
  );
});

test("both the versionless latest URL and a tag-addressed URL are accepted", async () => {
  // Installer names carry no version, so `releases/latest/download/<name>` has
  // to work end to end. A stable release resolves through `latest`; a beta
  // release is still addressed through its own tag, and the stable channel
  // never sees it.
  const cases = [
    {
      base: "https://github.com/estelwalks/aitracker/releases/latest/download",
      currentVersion: "1.0.0",
      version: "1.1.0",
      channel: "stable",
      prerelease: false,
    },
    {
      base: "https://github.com/estelwalks/aitracker/releases/download/v1.1.0-beta.1",
      currentVersion: "1.0.0-beta.1",
      version: "1.1.0-beta.1",
      channel: "beta",
      prerelease: true,
    },
  ];
  for (const { base, currentVersion, version, channel, prerelease } of cases) {
    const manager = new UpdateManager({
      currentVersion,
      isPackaged: true,
      platform: "darwin",
      arch: "x64",
      tempDirectory: "/tmp/aitracker-updates",
      fetchFn: async (url) => {
        if (url.includes("api.github.com")) {
          return response([
            {
              tag_name: `v${version}`,
              prerelease,
              assets: [
                {
                  name: "AITracker-x64.dmg",
                  browser_download_url: `${base}/AITracker-x64.dmg`,
                },
                {
                  name: "AITracker-arm64.dmg",
                  browser_download_url: `${base}/AITracker-arm64.dmg`,
                },
                {
                  name: "AITracker-Setup-x64.exe",
                  browser_download_url: `${base}/AITracker-Setup-x64.exe`,
                },
                {
                  name: "AITracker-Setup-arm64.exe",
                  browser_download_url: `${base}/AITracker-Setup-arm64.exe`,
                },
                {
                  name: "release-metadata.json",
                  browser_download_url: `${base}/release-metadata.json`,
                },
              ],
            },
          ]);
        }
        if (url.endsWith("release-metadata.json")) {
          return response({
            schemaVersion: 1,
            appVersion: version,
            channel,
            repository: "estelwalks/aitracker",
            gitTag: `v${version}`,
            artifacts: {
              "darwin-arm64": {
                name: "AITracker-arm64.dmg",
                url: `${base}/AITracker-arm64.dmg`,
                sha256: downloadedSha256,
                size: downloadedBytes.byteLength,
              },
              "darwin-x64": {
                name: "AITracker-x64.dmg",
                url: `${base}/AITracker-x64.dmg`,
                sha256: downloadedSha256,
                size: downloadedBytes.byteLength,
              },
              "win32-x64": {
                name: "AITracker-Setup-x64.exe",
                url: `${base}/AITracker-Setup-x64.exe`,
                sha256: downloadedSha256,
                size: downloadedBytes.byteLength,
              },
              "win32-arm64": {
                name: "AITracker-Setup-arm64.exe",
                url: `${base}/AITracker-Setup-arm64.exe`,
                sha256: downloadedSha256,
                size: downloadedBytes.byteLength,
              },
            },
          });
        }
        return new Response(downloadedBytes, { status: 200 });
      },
      mkdirFn: async () => undefined,
      writeFileFn: async () => undefined,
    });

    const state = await manager.startAutomaticCheck();
    assert.equal(state.status, "downloaded", `${base} must be accepted`);
    assert.equal(state.latestVersion, version);
    assert.equal(state.assetName, "AITracker-x64.dmg");
    assert.equal(state.downloadUrl, `${base}/AITracker-x64.dmg`);
  }
});

test("automatic checks use the GitHub tag and download its installer", async () => {
  const written: Array<{ path: string; data: Uint8Array }> = [];
  const manager = new UpdateManager({
    currentVersion: "1.0.0",
    isPackaged: true,
    platform: "darwin",
    arch: "x64",
    tempDirectory: "/tmp/aitracker-updates",
    fetchFn: async (url) => {
      if (url.includes("api.github.com")) {
        return response([
          {
            tag_name: "v2.0.0",
            published_at: "2026-08-31T12:34:56Z",
            html_url:
              "https://github.com/estelwalks/aitracker/releases/tag/v2.0.0",
            assets: [
              {
                name: "AITracker-arm64.dmg",
                browser_download_url:
                  "https://github.com/estelwalks/aitracker/releases/download/v2.0.0/AITracker-arm64.dmg",
              },
              {
                name: "AITracker-x64.dmg",
                browser_download_url: releaseUrl,
              },
              {
                name: "AITracker-Setup-x64.exe",
                browser_download_url:
                  "https://github.com/estelwalks/aitracker/releases/download/v2.0.0/AITracker-Setup-x64.exe",
              },
              {
                name: "AITracker-Setup-arm64.exe",
                browser_download_url:
                  "https://github.com/estelwalks/aitracker/releases/download/v2.0.0/AITracker-Setup-arm64.exe",
              },
              {
                name: "release-metadata.json",
                browser_download_url: metadataUrl,
              },
            ],
          },
        ]);
      }
      if (url.endsWith("release-metadata.json")) {
        return response({
          schemaVersion: 1,
          appVersion: "2.0.0",
          channel: "stable",
          repository: "estelwalks/aitracker",
          gitTag: "v2.0.0",
          artifacts: {
            "darwin-arm64": {
              name: "AITracker-arm64.dmg",
              url: "https://github.com/estelwalks/aitracker/releases/download/v2.0.0/AITracker-arm64.dmg",
              sha256: downloadedSha256,
              size: downloadedBytes.byteLength,
            },
            "darwin-x64": {
              name: "AITracker-x64.dmg",
              url: releaseUrl,
              sha256: downloadedSha256,
              size: downloadedBytes.byteLength,
            },
            "win32-x64": {
              name: "AITracker-Setup-x64.exe",
              url: "https://github.com/estelwalks/aitracker/releases/download/v2.0.0/AITracker-Setup-x64.exe",
              sha256: downloadedSha256,
              size: downloadedBytes.byteLength,
            },
            "win32-arm64": {
              name: "AITracker-Setup-arm64.exe",
              url: "https://github.com/estelwalks/aitracker/releases/download/v2.0.0/AITracker-Setup-arm64.exe",
              sha256: downloadedSha256,
              size: downloadedBytes.byteLength,
            },
          },
        });
      }
      return new Response(downloadedBytes, { status: 200 });
    },
    mkdirFn: async () => undefined,
    writeFileFn: async (path, data) => written.push({ path, data }),
  });

  const state = await manager.startAutomaticCheck();
  assert.equal(state.status, "downloaded");
  assert.equal(state.latestVersion, "2.0.0");
  assert.equal(state.releaseDate, "2026-08-31T12:34:56Z");
  assert.equal(state.assetName, "AITracker-x64.dmg");
  assert.equal(written.length, 1);
  assert.deepEqual([...written[0]!.data], [...downloadedBytes]);
});

test("metadata may use the versionless URL while the release lists its tag URL", async () => {
  // The released release-metadata.json records releases/latest/download/<name>
  // (that is the point of dropping the version from the names), but GitHub
  // lists a release's assets under its own tag. The updater must accept the
  // mismatch and download the tag-addressed asset the release advertises, so
  // the bytes stay those its sha256 was computed from.
  const latestBase =
    "https://github.com/estelwalks/aitracker/releases/latest/download";
  const tagBase =
    "https://github.com/estelwalks/aitracker/releases/download/v2.0.0";
  const written: Array<{ path: string; data: Uint8Array }> = [];
  const manager = new UpdateManager({
    currentVersion: "1.0.0",
    isPackaged: true,
    platform: "darwin",
    arch: "x64",
    tempDirectory: "/tmp/aitracker-updates",
    fetchFn: async (url) => {
      if (url.includes("api.github.com")) {
        return response([
          {
            tag_name: "v2.0.0",
            published_at: "2026-08-31T12:34:56Z",
            assets: [
              {
                name: "AITracker-arm64.dmg",
                browser_download_url: `${tagBase}/AITracker-arm64.dmg`,
              },
              {
                name: "AITracker-x64.dmg",
                browser_download_url: `${tagBase}/AITracker-x64.dmg`,
              },
              {
                name: "AITracker-Setup-x64.exe",
                browser_download_url: `${tagBase}/AITracker-Setup-x64.exe`,
              },
              {
                name: "AITracker-Setup-arm64.exe",
                browser_download_url: `${tagBase}/AITracker-Setup-arm64.exe`,
              },
              {
                name: "release-metadata.json",
                browser_download_url: `${tagBase}/release-metadata.json`,
              },
            ],
          },
        ]);
      }
      if (url.endsWith("release-metadata.json")) {
        return response({
          schemaVersion: 1,
          appVersion: "2.0.0",
          channel: "stable",
          repository: "estelwalks/aitracker",
          gitTag: "v2.0.0",
          artifacts: {
            "darwin-arm64": {
              name: "AITracker-arm64.dmg",
              url: `${latestBase}/AITracker-arm64.dmg`,
              sha256: downloadedSha256,
              size: downloadedBytes.byteLength,
            },
            "darwin-x64": {
              name: "AITracker-x64.dmg",
              url: `${latestBase}/AITracker-x64.dmg`,
              sha256: downloadedSha256,
              size: downloadedBytes.byteLength,
            },
            "win32-x64": {
              name: "AITracker-Setup-x64.exe",
              url: `${latestBase}/AITracker-Setup-x64.exe`,
              sha256: downloadedSha256,
              size: downloadedBytes.byteLength,
            },
            "win32-arm64": {
              name: "AITracker-Setup-arm64.exe",
              url: `${latestBase}/AITracker-Setup-arm64.exe`,
              sha256: downloadedSha256,
              size: downloadedBytes.byteLength,
            },
          },
        });
      }
      return new Response(downloadedBytes, { status: 200 });
    },
    mkdirFn: async () => undefined,
    writeFileFn: async (path, data) => {
      written.push({ path, data });
    },
  });

  const state = await manager.startAutomaticCheck();
  assert.equal(state.status, "downloaded");
  assert.equal(state.assetName, "AITracker-x64.dmg");
  assert.equal(state.downloadUrl, `${tagBase}/AITracker-x64.dmg`);
  assert.equal(written.length, 1);
  assert.equal(
    written[0]!.path,
    "/tmp/aitracker-updates/aitracker-AITracker-x64.dmg",
  );
});

test("the released metadata shape is accepted for a 1.0.1 client", async () => {
  // release-metadata.json lists three platforms and names versioned installers
  // at tag-addressed URLs. Both halves are load-bearing:
  //  - three keys, because a client released before 1.0.2 rejects the whole
  //    document when it carries a platform key it does not know (win32-arm64),
  //    which would stop those installs from updating themselves;
  //  - versioned names and `releases/download/v<version>/<name>` URLs, because
  //    those clients compare the URL to that exact string and require the asset
  //    to exist.
  // Requiring all four keys here once rejected every release that omitted
  // win32-arm64, and versionless names broke the older clients.
  const base =
    "https://github.com/estelwalks/aitracker/releases/download/v1.0.2";
  const payload = Buffer.from("installer-bytes-1.0.2");
  const sha256 = createHash("sha256").update(payload).digest("hex");
  const names: Record<string, string> = {
    "darwin-arm64": "AITracker-1.0.2-arm64.dmg",
    "darwin-x64": "AITracker-1.0.2-x64.dmg",
    "win32-x64": "AITracker-Setup-1.0.2-x64.exe",
  };
  const artifacts = Object.fromEntries(
    Object.entries(names).map(([key, name]) => [
      key,
      { name, url: `${base}/${name}`, sha256, size: payload.byteLength },
    ]),
  );
  const manager = new UpdateManager({
    currentVersion: "1.0.1",
    isPackaged: true,
    platform: "darwin",
    arch: "x64",
    tempDirectory: "/tmp/aitracker-updates",
    fetchFn: async (url) => {
      if (url.includes("api.github.com")) {
        return response([
          {
            tag_name: "v1.0.2",
            prerelease: false,
            draft: false,
            assets: [
              ...Object.values(names).map((name) => ({
                name,
                browser_download_url: `${base}/${name}`,
              })),
              // Attached but not listed in the metadata.
              {
                name: "AITracker-Setup-1.0.2-arm64.exe",
                browser_download_url: `${base}/AITracker-Setup-1.0.2-arm64.exe`,
              },
              {
                name: "release-metadata.json",
                browser_download_url: `${base}/release-metadata.json`,
              },
            ],
          },
        ]);
      }
      if (url.endsWith("release-metadata.json")) {
        return response({
          schemaVersion: 1,
          appVersion: "1.0.2",
          channel: "stable",
          repository: "estelwalks/aitracker",
          gitTag: "v1.0.2",
          artifacts,
        });
      }
      return new Response(payload, { status: 200 });
    },
    mkdirFn: async () => undefined,
    writeFileFn: async () => undefined,
  });

  const state = await manager.startAutomaticCheck();
  assert.equal(state.status, "downloaded");
  assert.equal(state.latestVersion, "1.0.2");
  assert.equal(state.assetName, "AITracker-1.0.2-x64.dmg");
  assert.equal(state.downloadUrl, `${base}/AITracker-1.0.2-x64.dmg`);
});

test("a document listing an unknown platform is still rejected", async () => {
  // The three known keys plus win32-arm64 are accepted; anything else means the
  // document is not ours. Covered by the metadata shape test above together
  // with the fixtures, and asserted here through a bogus platform key.
  const base =
    "https://github.com/estelwalks/aitracker/releases/download/v1.0.2";
  const payload = Buffer.from("bytes");
  const sha256 = createHash("sha256").update(payload).digest("hex");
  const names: Record<string, string> = {
    "darwin-arm64": "AITracker-1.0.2-arm64.dmg",
    "darwin-x64": "AITracker-1.0.2-x64.dmg",
    "win32-x64": "AITracker-Setup-1.0.2-x64.exe",
  };
  const manager = new UpdateManager({
    currentVersion: "1.0.1",
    isPackaged: true,
    platform: "darwin",
    arch: "x64",
    tempDirectory: "/tmp/aitracker-updates",
    fetchFn: async (url) => {
      if (url.includes("api.github.com")) {
        return response([
          {
            tag_name: "v1.0.2",
            prerelease: false,
            assets: [
              ...Object.values(names).map((name) => ({
                name,
                browser_download_url: `${base}/${name}`,
              })),
              {
                name: "release-metadata.json",
                browser_download_url: `${base}/release-metadata.json`,
              },
            ],
          },
        ]);
      }
      if (url.endsWith("release-metadata.json")) {
        return response({
          schemaVersion: 1,
          appVersion: "1.0.2",
          channel: "stable",
          repository: "estelwalks/aitracker",
          gitTag: "v1.0.2",
          artifacts: {
            ...Object.fromEntries(
              Object.entries(names).map(([key, name]) => [
                key,
                {
                  name,
                  url: `${base}/${name}`,
                  sha256,
                  size: payload.byteLength,
                },
              ]),
            ),
            "linux-x64": {
              name: "AITracker.AppImage",
              url: `${base}/AITracker.AppImage`,
              sha256,
              size: payload.byteLength,
            },
          },
        });
      }
      return new Response(payload, { status: 200 });
    },
    mkdirFn: async () => undefined,
    writeFileFn: async () => undefined,
  });

  const state = await manager.checkForUpdates();
  assert.equal(state.status, "error");
  assert.equal(state.errorCode, "download");
});

test("release selection rejects tags that are not strict semver", async () => {
  const manager = new UpdateManager({
    currentVersion: "1.0.0",
    isPackaged: true,
    platform: "darwin",
    arch: "x64",
    tempDirectory: "/tmp/aitracker-updates",
    fetchFn: async (url) => {
      if (url.includes("api.github.com")) {
        return response([
          { ...release("2.0"), tag_name: "v2.0" },
          { ...release("2.0.0-01"), tag_name: "v2.0.0-01" },
          { ...release("2.0.0"), tag_name: "2.0.0" },
          { ...release("2.0.0"), tag_name: "v2.0.0 " },
        ]);
      }
      throw new Error(`unexpected URL: ${url}`);
    },
  });

  const state = await manager.checkForUpdates();
  assert.equal(state.status, "unknown");
  assert.equal(state.errorCode, "not-found");
});

function release(
  version: string,
  options: { prerelease?: boolean; assetUrl?: string } = {},
) {
  // Asset names carry no version (the tag does), which is what keeps
  // releases/latest/download/<name> valid across releases. The fixture keeps
  // tag-addressed URLs so each case stays independent of `latest`.
  const base = `https://github.com/estelwalks/aitracker/releases/download/v${version}`;
  const assetUrl = options.assetUrl ?? `${base}/AITracker-x64.dmg`;
  return {
    tag_name: `v${version}`,
    prerelease: options.prerelease ?? version.includes("-"),
    html_url: `https://github.com/estelwalks/aitracker/releases/tag/v${version}`,
    assets: [
      { name: "AITracker-x64.dmg", browser_download_url: assetUrl },
      {
        name: "AITracker-arm64.dmg",
        browser_download_url: `${base}/AITracker-arm64.dmg`,
      },
      {
        name: "AITracker-Setup-x64.exe",
        browser_download_url: `${base}/AITracker-Setup-x64.exe`,
      },
      {
        name: "AITracker-Setup-arm64.exe",
        browser_download_url: `${base}/AITracker-Setup-arm64.exe`,
      },
      {
        name: "release-metadata.json",
        browser_download_url: `${base}/release-metadata.json`,
      },
    ],
  };
}

function metadataFor(
  version: string,
  channel: "stable" | "beta",
  artifact: Record<string, unknown> = {},
) {
  return {
    schemaVersion: 1,
    appVersion: version,
    channel,
    repository: "estelwalks/aitracker",
    gitTag: `v${version}`,
    artifacts: {
      "darwin-arm64": {
        name: "AITracker-arm64.dmg",
        url: `https://github.com/estelwalks/aitracker/releases/download/v${version}/AITracker-arm64.dmg`,
        sha256: downloadedSha256,
        size: downloadedBytes.byteLength,
      },
      [`darwin-x64`]: {
        name: "AITracker-x64.dmg",
        url: `https://github.com/estelwalks/aitracker/releases/download/v${version}/AITracker-x64.dmg`,
        sha256: downloadedSha256,
        size: downloadedBytes.byteLength,
        ...artifact,
      },
      // Every published release lists all four platforms, so the fixture does
      // too; a missing key is rejected by metadataArtifactOf.
      "win32-arm64": {
        name: "AITracker-Setup-arm64.exe",
        url: `https://github.com/estelwalks/aitracker/releases/download/v${version}/AITracker-Setup-arm64.exe`,
        sha256: downloadedSha256,
        size: downloadedBytes.byteLength,
      },
      "win32-x64": {
        name: "AITracker-Setup-x64.exe",
        url: `https://github.com/estelwalks/aitracker/releases/download/v${version}/AITracker-Setup-x64.exe`,
        sha256: downloadedSha256,
        size: downloadedBytes.byteLength,
      },
    },
  };
}

function managerForRelease(
  releases: unknown[],
  metadata: unknown,
  options: Partial<ConstructorParameters<typeof UpdateManager>[0]> = {},
  downloadBody: Uint8Array = downloadedBytes,
) {
  const installerUrl = (
    releases[0] as { assets?: Array<{ browser_download_url?: string }> }
  ).assets?.[0]?.browser_download_url;
  return new UpdateManager({
    currentVersion: "1.0.0",
    isPackaged: true,
    platform: "darwin",
    arch: "x64",
    tempDirectory: "/tmp/aitracker-updates",
    ...options,
    fetchFn: async (url) => {
      if (url.includes("api.github.com")) return response(releases);
      if (url.endsWith("release-metadata.json")) return response(metadata);
      if (url === installerUrl) return new Response(downloadBody);
      throw new Error(`unexpected URL: ${url}`);
    },
  });
}

test("stable and beta channels isolate prereleases and allow beta stable fallback", async () => {
  const stable = release("1.5.0");
  const beta = release("2.0.0-beta.1", { prerelease: true });
  const stableManager = managerForRelease(
    [beta, stable],
    metadataFor("1.5.0", "stable"),
    { channel: "stable" },
  );
  assert.equal((await stableManager.checkForUpdates()).latestVersion, "1.5.0");

  const betaManager = managerForRelease(
    [beta, stable],
    metadataFor("2.0.0-beta.1", "beta"),
    { currentVersion: "1.0.0-beta.1", channel: "beta" },
  );
  assert.equal(
    (await betaManager.checkForUpdates()).latestVersion,
    "2.0.0-beta.1",
  );

  const laterStable = release("2.1.0");
  const betaStableFallback = managerForRelease(
    [beta, laterStable],
    metadataFor("2.1.0", "stable"),
    { currentVersion: "2.0.0-beta.1", channel: "beta" },
  );
  assert.equal(
    (await betaStableFallback.checkForUpdates()).latestVersion,
    "2.1.0",
  );
});

test("metadata selects the exact platform artifact", async () => {
  const winUrl =
    "https://github.com/estelwalks/aitracker/releases/download/v2.0.0/AITracker-x64.exe";
  const manager = new UpdateManager({
    currentVersion: "1.0.0",
    isPackaged: true,
    platform: "win32",
    arch: "x64",
    tempDirectory: "/tmp/aitracker-updates",
    fetchFn: async (url) => {
      if (url.includes("api.github.com")) {
        return response([
          {
            ...release("2.0.0"),
            assets: [
              {
                name: "AITracker-arm64.dmg",
                browser_download_url:
                  "https://github.com/estelwalks/aitracker/releases/download/v2.0.0/AITracker-arm64.dmg",
              },
              {
                name: "AITracker-x64.dmg",
                browser_download_url: releaseUrl,
              },
              { name: "AITracker-x64.exe", browser_download_url: winUrl },
              {
                name: "release-metadata.json",
                browser_download_url: metadataUrl,
              },
            ],
          },
        ]);
      }
      if (url.endsWith("release-metadata.json")) {
        return response({
          ...metadataFor("2.0.0", "stable"),
          artifacts: {
            "darwin-arm64": metadataFor("2.0.0", "stable").artifacts[
              "darwin-arm64"
            ],
            "darwin-x64": metadataFor("2.0.0", "stable").artifacts[
              "darwin-x64"
            ],
            "win32-x64": {
              name: "AITracker-x64.exe",
              url: winUrl,
              sha256: downloadedSha256,
              size: downloadedBytes.byteLength,
            },
          },
        });
      }
      return new Response(downloadedBytes);
    },
  });
  const state = await manager.checkForUpdates();
  assert.equal(state.assetName, "AITracker-x64.exe");
  assert.equal(state.downloadUrl, winUrl);
});

test("missing, malformed, and incorrect metadata fail before download", async () => {
  for (const metadata of [
    null,
    { schemaVersion: 2 },
    metadataFor("2.0.0", "stable", { sha256: "bad" }),
    metadataFor("2.0.0", "stable", {
      url: "https://example.invalid/releases/download/v2.0.0/installer.dmg",
    }),
  ]) {
    let downloadCalls = 0;
    const releaseValue = release("2.0.0");
    const manager = new UpdateManager({
      currentVersion: "1.0.0",
      isPackaged: true,
      platform: "darwin",
      arch: "x64",
      tempDirectory: "/tmp/aitracker-updates",
      fetchFn: async (url) => {
        if (url.includes("api.github.com")) return response([releaseValue]);
        if (url.endsWith("release-metadata.json")) {
          return metadata === null
            ? new Response("missing", { status: 404 })
            : response(metadata);
        }
        downloadCalls += 1;
        return new Response(downloadedBytes);
      },
    });
    const state = await manager.checkForUpdates();
    assert.equal(state.status, "error");
    assert.equal(state.errorCode, "download");
    assert.equal(downloadCalls, 0);
  }
});

test("checksum and size limits reject downloads, and a write failure cleans up", async () => {
  const badChecksumManager = managerForRelease(
    [release("2.0.0")],
    metadataFor("2.0.0", "stable", { sha256: "f".repeat(64) }),
  );
  assert.equal(
    (await badChecksumManager.startAutomaticCheck()).status,
    "error",
  );

  const oversizedManager = managerForRelease(
    [release("2.0.0")],
    metadataFor("2.0.0", "stable", { size: 4 }),
    { maxDownloadBytes: 3 },
  );
  assert.equal((await oversizedManager.checkForUpdates()).status, "error");

  const oversizedDownloadManager = managerForRelease(
    [release("2.0.0")],
    metadataFor("2.0.0", "stable"),
    { maxDownloadBytes: 3 },
    new Uint8Array([1, 2, 3, 4]),
  );
  assert.equal(
    (await oversizedDownloadManager.startAutomaticCheck()).status,
    "error",
  );

  const truncatedDownloadManager = managerForRelease(
    [release("2.0.0")],
    metadataFor("2.0.0", "stable", { size: 4 }),
    { maxDownloadBytes: 10 },
  );
  assert.equal(
    (await truncatedDownloadManager.startAutomaticCheck()).status,
    "error",
  );

  const unlinked: string[] = [];
  const writeFailureManager = managerForRelease(
    [release("2.0.0")],
    metadataFor("2.0.0", "stable"),
    {
      writeFileFn: async () => {
        throw new Error("disk full");
      },
      unlinkFn: async (path) => unlinked.push(path),
    },
  );
  assert.equal(
    (await writeFailureManager.startAutomaticCheck()).status,
    "error",
  );
  assert.deepEqual(unlinked, [
    join("/tmp/aitracker-updates", "aitracker-AITracker-x64.dmg"),
  ]);
});

test("production downloads stream chunks, hash them, and clean failed files", async () => {
  const directory = await mkdtemp("/tmp/aitracker-update-stream-");
  const streamedBytes = new Uint8Array([1, 2, 3, 4, 5, 6]);
  const expectedHash = createHash("sha256").update(streamedBytes).digest("hex");
  let pulls = 0;
  const body = () =>
    new ReadableStream<Uint8Array>({
      pull(controller) {
        const start = pulls * 2;
        if (start >= streamedBytes.length) {
          controller.close();
          return;
        }
        pulls += 1;
        controller.enqueue(streamedBytes.slice(start, start + 2));
      },
    });
  const streamingManager = new UpdateManager({
    currentVersion: "1.0.0",
    isPackaged: true,
    platform: "darwin",
    arch: "x64",
    tempDirectory: directory,
    fetchFn: async (url) => {
      if (url.includes("api.github.com")) return response([release("2.0.0")]);
      if (url.endsWith("release-metadata.json")) {
        return response(
          metadataFor("2.0.0", "stable", {
            sha256: expectedHash,
            size: streamedBytes.byteLength,
          }),
        );
      }
      return new Response(body());
    },
  });
  assert.equal(
    (await streamingManager.startAutomaticCheck()).status,
    "downloaded",
  );
  assert.ok(pulls > 1);
  assert.deepEqual(
    [...(await readFile(`${directory}/aitracker-AITracker-x64.dmg`))],
    [...streamedBytes],
  );

  const failedDirectory = await mkdtemp("/tmp/aitracker-update-stream-fail-");
  const failedManager = new UpdateManager({
    currentVersion: "1.0.0",
    isPackaged: true,
    platform: "darwin",
    arch: "x64",
    tempDirectory: failedDirectory,
    fetchFn: async (url) => {
      if (url.includes("api.github.com")) return response([release("2.0.0")]);
      if (url.endsWith("release-metadata.json")) {
        return response(
          metadataFor("2.0.0", "stable", {
            sha256: expectedHash,
            size: streamedBytes.byteLength,
          }),
        );
      }
      return new Response(new Uint8Array([1, 2, 3]));
    },
  });
  assert.equal((await failedManager.startAutomaticCheck()).status, "error");
  assert.deepEqual(await readdir(failedDirectory), []);

  await rm(directory, { recursive: true, force: true });
  await rm(failedDirectory, { recursive: true, force: true });
});

test("disabled automatic updates do not perform a background check", async () => {
  let calls = 0;
  const manager = new UpdateManager({
    currentVersion: "1.0.0",
    isPackaged: true,
    platform: "darwin",
    arch: "x64",
    tempDirectory: "/tmp/aitracker-updates",
    fetchFn: async () => {
      calls += 1;
      return response([]);
    },
  });
  manager.setEnabled(false);
  assert.equal((await manager.startAutomaticCheck()).status, "idle");
  assert.equal(calls, 0);
});

test("development builds never query GitHub", async () => {
  let calls = 0;
  const manager = new UpdateManager({
    currentVersion: "1.0.0",
    isPackaged: false,
    platform: "darwin",
    arch: "x64",
    tempDirectory: "/tmp/aitracker-updates",
    fetchFn: async () => {
      calls += 1;
      return response([]);
    },
  });
  const state = await manager.startAutomaticCheck();
  assert.equal(state.status, "idle");
  assert.equal(calls, 0);
  assert.equal((await manager.checkForUpdates()).errorCode, "development");
});

test("automatic checks keep a waiting installer instead of re-downloading", async () => {
  const writes: string[] = [];
  const unlinked: string[] = [];
  const manager = managerForRelease(
    [release("2.0.0")],
    metadataFor("2.0.0", "stable"),
    {
      writeFileFn: async (path) => {
        writes.push(path);
      },
      unlinkFn: async (path) => {
        unlinked.push(path);
      },
    },
  );
  assert.equal((await manager.startAutomaticCheck()).status, "downloaded");
  assert.equal(writes.length, 1);
  const second = await manager.startAutomaticCheck();
  assert.equal(second.status, "downloaded");
  assert.equal(writes.length, 1);
  assert.deepEqual(unlinked, []);
});

test("manual re-check keeps a waiting installer when no newer release exists", async () => {
  const unlinked: string[] = [];
  const manager = managerForRelease(
    [release("2.0.0")],
    metadataFor("2.0.0", "stable"),
    {
      writeFileFn: async () => undefined,
      unlinkFn: async (path) => {
        unlinked.push(path);
      },
    },
  );
  assert.equal((await manager.startAutomaticCheck()).status, "downloaded");
  const state = await manager.checkForUpdates();
  assert.equal(state.status, "downloaded");
  assert.equal(state.latestVersion, "2.0.0");
  assert.deepEqual(unlinked, []);
});

test("manual re-check replaces a waiting installer when a newer release appears", async () => {
  const writes: string[] = [];
  const unlinked: string[] = [];
  let releases: unknown[] = [release("2.0.0")];
  let metadata: unknown = metadataFor("2.0.0", "stable");
  const manager = new UpdateManager({
    currentVersion: "1.0.0",
    isPackaged: true,
    platform: "darwin",
    arch: "x64",
    tempDirectory: "/tmp/aitracker-updates",
    writeFileFn: async (path) => {
      writes.push(path);
    },
    unlinkFn: async (path) => {
      unlinked.push(path);
    },
    fetchFn: async (url) => {
      if (url.includes("api.github.com")) return response(releases);
      if (url.endsWith("release-metadata.json")) return response(metadata);
      return new Response(downloadedBytes);
    },
  });
  assert.equal((await manager.startAutomaticCheck()).status, "downloaded");
  assert.equal(writes.length, 1);

  releases = [release("2.1.0")];
  metadata = metadataFor("2.1.0", "stable");
  const state = await manager.checkForUpdates();
  assert.equal(state.status, "available");
  assert.equal(state.latestVersion, "2.1.0");
  assert.deepEqual(unlinked, [
    join("/tmp/aitracker-updates", "aitracker-AITracker-x64.dmg"),
  ]);

  const next = await manager.downloadUpdate();
  assert.equal(next.status, "downloaded");
  assert.equal(next.latestVersion, "2.1.0");
  assert.equal(writes.length, 2);
});

test("re-download overwrites a stale installer file left in the temp directory", async () => {
  const directory = await mkdtemp("/tmp/aitracker-update-stale-");
  const stalePath = join(directory, "aitracker-AITracker-x64.dmg");
  await writeFile(stalePath, new Uint8Array([9, 9, 9]));
  const manager = new UpdateManager({
    currentVersion: "1.0.0",
    isPackaged: true,
    platform: "darwin",
    arch: "x64",
    tempDirectory: directory,
    fetchFn: async (url) => {
      if (url.includes("api.github.com")) return response([release("2.0.0")]);
      if (url.endsWith("release-metadata.json")) {
        return response(metadataFor("2.0.0", "stable"));
      }
      return new Response(downloadedBytes);
    },
  });
  assert.equal((await manager.startAutomaticCheck()).status, "downloaded");
  assert.deepEqual([...(await readFile(stalePath))], [...downloadedBytes]);
  await rm(directory, { recursive: true, force: true });
});

test("a download that never answers aborts on the connect budget", async () => {
  const manager = new UpdateManager({
    currentVersion: "1.0.0",
    isPackaged: true,
    platform: "darwin",
    arch: "x64",
    tempDirectory: "/tmp/aitracker-updates",
    downloadConnectTimeoutMs: 25,
    downloadIdleTimeoutMs: 60_000,
    writeFileFn: async () => undefined,
    fetchFn: async (url, init) => {
      if (url.includes("api.github.com")) return response([release("2.0.0")]);
      if (url.endsWith("release-metadata.json")) {
        return response(metadataFor("2.0.0", "stable"));
      }
      // The peer never answers: the request hangs until aborted.
      await new Promise<never>((_, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      });
      throw new Error("unreachable");
    },
  });
  const state = await manager.startAutomaticCheck();
  assert.equal(state.status, "error");
  assert.equal(state.errorCode, "download");
});

test("a download that stops sending data aborts on the idle budget", async () => {
  const manager = new UpdateManager({
    currentVersion: "1.0.0",
    isPackaged: true,
    platform: "darwin",
    arch: "x64",
    tempDirectory: "/tmp/aitracker-updates",
    downloadConnectTimeoutMs: 60_000,
    downloadIdleTimeoutMs: 25,
    writeFileFn: async () => undefined,
    fetchFn: async (url, init) => {
      if (url.includes("api.github.com")) return response([release("2.0.0")]);
      if (url.endsWith("release-metadata.json")) {
        return response(metadataFor("2.0.0", "stable"));
      }
      const signal = init?.signal;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([1]));
            signal?.addEventListener("abort", () =>
              controller.error(new Error("aborted")),
            );
          },
        }),
        { status: 200 },
      );
    },
  });
  const state = await manager.startAutomaticCheck();
  assert.equal(state.status, "error");
  assert.equal(state.errorCode, "download");
});

test("a slow but steady download is not cut off by a wall-clock budget", async () => {
  const streamedBytes = new Uint8Array([1, 2, 3, 4, 5, 6]);
  const expectedHash = createHash("sha256").update(streamedBytes).digest("hex");
  const manager = new UpdateManager({
    currentVersion: "1.0.0",
    isPackaged: true,
    platform: "darwin",
    arch: "x64",
    tempDirectory: "/tmp/aitracker-updates",
    downloadConnectTimeoutMs: 60_000,
    // Chunks arrive every 10 ms for ~30 ms total: far slower than a fixed
    // total budget would allow, but never silent long enough to trip 25 ms.
    downloadIdleTimeoutMs: 25,
    writeFileFn: async () => undefined,
    fetchFn: async (url) => {
      if (url.includes("api.github.com")) return response([release("2.0.0")]);
      if (url.endsWith("release-metadata.json")) {
        return response(
          metadataFor("2.0.0", "stable", {
            sha256: expectedHash,
            size: streamedBytes.byteLength,
          }),
        );
      }
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            let offset = 0;
            const timer = setInterval(() => {
              if (offset >= streamedBytes.length) {
                clearInterval(timer);
                controller.close();
                return;
              }
              controller.enqueue(streamedBytes.slice(offset, offset + 2));
              offset += 2;
            }, 10);
          },
        }),
        { status: 200 },
      );
    },
  });
  assert.equal((await manager.startAutomaticCheck()).status, "downloaded");
});

test("download progress is broadcast through the state listener", async () => {
  const observed: Array<{ status: string; progress?: unknown }> = [];
  const manager = managerForRelease(
    [release("2.0.0")],
    metadataFor("2.0.0", "stable"),
    {
      writeFileFn: async () => undefined,
    },
  );
  manager.subscribe((state) => {
    observed.push({ status: state.status, progress: state.progress });
  });
  assert.equal((await manager.startAutomaticCheck()).status, "downloaded");
  const downloading = observed.find(
    (entry) => entry.status === "downloading" && entry.progress !== undefined,
  );
  assert.ok(downloading, "expected a downloading progress broadcast");
  assert.deepEqual(downloading.progress, {
    downloadedBytes: 0,
    totalBytes: downloadedBytes.byteLength,
  });
  const done = observed.at(-1);
  assert.deepEqual(done?.progress, {
    downloadedBytes: downloadedBytes.byteLength,
    totalBytes: downloadedBytes.byteLength,
  });
});

test("an already verified installer on disk is reused instead of re-downloaded", async () => {
  const directory = await mkdtemp("/tmp/aitracker-update-reuse-");
  let installerRequests = 0;
  const manager = new UpdateManager({
    currentVersion: "1.0.0",
    isPackaged: true,
    platform: "darwin",
    arch: "x64",
    tempDirectory: directory,
    fetchFn: async (url) => {
      if (url.includes("api.github.com")) return response([release("2.0.0")]);
      if (url.endsWith("release-metadata.json")) {
        return response(metadataFor("2.0.0", "stable"));
      }
      installerRequests += 1;
      return new Response(downloadedBytes);
    },
  });
  // A previous attempt left the exact package behind.
  await writeFile(
    join(directory, "aitracker-AITracker-x64.dmg"),
    downloadedBytes,
  );
  const state = await manager.startAutomaticCheck();
  assert.equal(state.status, "downloaded");
  assert.equal(installerRequests, 0, "must not re-download a verified package");
  assert.deepEqual(state.progress, {
    downloadedBytes: downloadedBytes.byteLength,
    totalBytes: downloadedBytes.byteLength,
  });
  await rm(directory, { recursive: true, force: true });
});

test("a tampered file on disk is not reused", async () => {
  const directory = await mkdtemp("/tmp/aitracker-update-reuse-bad-");
  let installerRequests = 0;
  const manager = new UpdateManager({
    currentVersion: "1.0.0",
    isPackaged: true,
    platform: "darwin",
    arch: "x64",
    tempDirectory: directory,
    fetchFn: async (url) => {
      if (url.includes("api.github.com")) return response([release("2.0.0")]);
      if (url.endsWith("release-metadata.json")) {
        return response(metadataFor("2.0.0", "stable"));
      }
      installerRequests += 1;
      return new Response(downloadedBytes);
    },
  });
  await writeFile(
    join(directory, "aitracker-AITracker-x64.dmg"),
    new Uint8Array([9, 9, 9]),
  );
  assert.equal((await manager.startAutomaticCheck()).status, "downloaded");
  assert.equal(installerRequests, 1, "a mismatching file must be replaced");
  assert.deepEqual(
    [...(await readFile(join(directory, "aitracker-AITracker-x64.dmg")))],
    [...downloadedBytes],
  );
  await rm(directory, { recursive: true, force: true });
});
