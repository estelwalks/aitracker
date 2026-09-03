import assert from "node:assert/strict";
import test from "node:test";

import { UpdateManager, selectUpdateAsset } from "./update-manager.ts";

const releaseUrl =
  "https://github.com/estelwalks/aitracker/releases/download/v2.0.0/AITracker-2.0.0-x64.dmg";

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
            html_url:
              "https://github.com/estelwalks/aitracker/releases/tag/v2.0.0",
            assets: [
              {
                name: "AITracker-2.0.0-x64.dmg",
                browser_download_url: releaseUrl,
              },
            ],
          },
        ]);
      }
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    },
    mkdirFn: async () => undefined,
    writeFileFn: async (path, data) => written.push({ path, data }),
  });

  const state = await manager.startAutomaticCheck();
  assert.equal(state.status, "downloaded");
  assert.equal(state.latestVersion, "2.0.0");
  assert.equal(state.assetName, "AITracker-2.0.0-x64.dmg");
  assert.equal(written.length, 1);
  assert.deepEqual([...written[0]!.data], [1, 2, 3]);
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
