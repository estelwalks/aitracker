import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import test from "node:test";

import { UpdateManager, selectUpdateAsset } from "./update-manager.ts";

const releaseUrl =
  "https://github.com/estelwalks/aitracker/releases/download/v2.0.0/AITracker-2.0.0-x64.dmg";
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
      name: "AITracker-2.0.0-arm64.dmg",
      browser_download_url:
        "https://github.com/estelwalks/aitracker/releases/download/v2.0.0/AITracker-2.0.0-arm64.dmg",
    },
    { name: "AITracker-2.0.0-x64.dmg", browser_download_url: releaseUrl },
    {
      name: "AITracker-2.0.0-x64.dmg.sig",
      browser_download_url: `${releaseUrl}.sig`,
    },
  ];
  assert.deepEqual(selectUpdateAsset(assets, "darwin", "x64"), {
    name: "AITracker-2.0.0-x64.dmg",
    url: releaseUrl,
  });
  assert.equal(
    selectUpdateAsset(
      [
        {
          name: "AITracker-2.0.0-arm64.dmg",
          browser_download_url:
            "https://github.com/estelwalks/aitracker/releases/download/v2.0.0/AITracker-2.0.0-arm64.dmg",
        },
      ],
      "darwin",
      "x64",
    ),
    null,
  );
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
                name: "AITracker-2.0.0-arm64.dmg",
                browser_download_url:
                  "https://github.com/estelwalks/aitracker/releases/download/v2.0.0/AITracker-2.0.0-arm64.dmg",
              },
              {
                name: "AITracker-2.0.0-x64.dmg",
                browser_download_url: releaseUrl,
              },
              {
                name: "AITracker-Setup-2.0.0-x64.exe",
                browser_download_url:
                  "https://github.com/estelwalks/aitracker/releases/download/v2.0.0/AITracker-Setup-2.0.0-x64.exe",
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
              name: "AITracker-2.0.0-arm64.dmg",
              url: "https://github.com/estelwalks/aitracker/releases/download/v2.0.0/AITracker-2.0.0-arm64.dmg",
              sha256: downloadedSha256,
              size: downloadedBytes.byteLength,
            },
            "darwin-x64": {
              name: "AITracker-2.0.0-x64.dmg",
              url: releaseUrl,
              sha256: downloadedSha256,
              size: downloadedBytes.byteLength,
            },
            "win32-x64": {
              name: "AITracker-Setup-2.0.0-x64.exe",
              url: "https://github.com/estelwalks/aitracker/releases/download/v2.0.0/AITracker-Setup-2.0.0-x64.exe",
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
  assert.equal(state.assetName, "AITracker-2.0.0-x64.dmg");
  assert.equal(written.length, 1);
  assert.deepEqual([...written[0]!.data], [...downloadedBytes]);
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
  const assetUrl =
    options.assetUrl ??
    `https://github.com/estelwalks/aitracker/releases/download/v${version}/AITracker-${version}-x64.dmg`;
  const metadataUrlForVersion = `https://github.com/estelwalks/aitracker/releases/download/v${version}/release-metadata.json`;
  return {
    tag_name: `v${version}`,
    prerelease: options.prerelease ?? version.includes("-"),
    html_url: `https://github.com/estelwalks/aitracker/releases/tag/v${version}`,
    assets: [
      { name: `AITracker-${version}-x64.dmg`, browser_download_url: assetUrl },
      {
        name: `AITracker-${version}-arm64.dmg`,
        browser_download_url: `https://github.com/estelwalks/aitracker/releases/download/v${version}/AITracker-${version}-arm64.dmg`,
      },
      {
        name: `AITracker-Setup-${version}-x64.exe`,
        browser_download_url: `https://github.com/estelwalks/aitracker/releases/download/v${version}/AITracker-Setup-${version}-x64.exe`,
      },
      {
        name: "release-metadata.json",
        browser_download_url: metadataUrlForVersion,
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
        name: `AITracker-${version}-arm64.dmg`,
        url: `https://github.com/estelwalks/aitracker/releases/download/v${version}/AITracker-${version}-arm64.dmg`,
        sha256: downloadedSha256,
        size: downloadedBytes.byteLength,
      },
      [`darwin-x64`]: {
        name: `AITracker-${version}-x64.dmg`,
        url: `https://github.com/estelwalks/aitracker/releases/download/v${version}/AITracker-${version}-x64.dmg`,
        sha256: downloadedSha256,
        size: downloadedBytes.byteLength,
        ...artifact,
      },
      "win32-x64": {
        name: `AITracker-Setup-${version}-x64.exe`,
        url: `https://github.com/estelwalks/aitracker/releases/download/v${version}/AITracker-Setup-${version}-x64.exe`,
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
    "https://github.com/estelwalks/aitracker/releases/download/v2.0.0/AITracker-2.0.0-x64.exe";
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
                name: "AITracker-2.0.0-arm64.dmg",
                browser_download_url:
                  "https://github.com/estelwalks/aitracker/releases/download/v2.0.0/AITracker-2.0.0-arm64.dmg",
              },
              {
                name: "AITracker-2.0.0-x64.dmg",
                browser_download_url: releaseUrl,
              },
              { name: "AITracker-2.0.0-x64.exe", browser_download_url: winUrl },
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
              name: "AITracker-2.0.0-x64.exe",
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
  assert.equal(state.assetName, "AITracker-2.0.0-x64.exe");
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
    "/tmp/aitracker-updates/aitracker-AITracker-2.0.0-x64.dmg",
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
    [...(await readFile(`${directory}/aitracker-AITracker-2.0.0-x64.dmg`))],
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

test("a verified installer remains until opened, then is cleaned on the next check", async () => {
  const unlinked: string[] = [];
  let openedPath = "";
  const manager = managerForRelease(
    [release("2.0.0")],
    metadataFor("2.0.0", "stable"),
    {
      writeFileFn: async (path) => undefined,
      unlinkFn: async (path) => unlinked.push(path),
      openInstaller: async (path) => {
        openedPath = path;
        return "";
      },
    },
  );

  assert.equal((await manager.startAutomaticCheck()).status, "downloaded");
  assert.deepEqual(unlinked, []);
  assert.deepEqual(await manager.installUpdate(), { opened: true });
  assert.deepEqual(unlinked, []);
  assert.ok(openedPath.endsWith("aitracker-AITracker-2.0.0-x64.dmg"));

  await manager.checkForUpdates();
  assert.deepEqual(unlinked, [openedPath]);
});

test("install only opens an integrity-verified installer", async () => {
  let opened = 0;
  const badManager = managerForRelease(
    [release("2.0.0")],
    metadataFor("2.0.0", "stable", { sha256: "f".repeat(64) }),
    {
      openInstaller: async () => {
        opened += 1;
        return "";
      },
    },
  );
  await badManager.startAutomaticCheck();
  assert.deepEqual(await badManager.installUpdate(), { opened: false });
  assert.equal(opened, 0);

  const goodManager = managerForRelease(
    [release("2.0.0")],
    metadataFor("2.0.0", "stable"),
    {
      openInstaller: async () => {
        opened += 1;
        return "";
      },
    },
  );
  await goodManager.startAutomaticCheck();
  assert.deepEqual(await goodManager.installUpdate(), { opened: true });
  assert.equal(opened, 1);
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
