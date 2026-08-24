import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  findTrayIconPath,
  TRAY_ICON_DATA_URL,
  TRAY_ICON_FILENAME,
} from "./tray-icon.js";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  assert.deepEqual(
    [...bytes.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
  );
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test("tray fallback is an 18px inline SVG data URL", () => {
  assert.match(TRAY_ICON_DATA_URL, /^data:image\/svg\+xml;base64,/u);
  const svg = Buffer.from(
    TRAY_ICON_DATA_URL.replace("data:image/svg+xml;base64,", ""),
    "base64",
  ).toString("utf8");
  assert.match(svg, /width="18"/u);
  assert.match(svg, /height="18"/u);
});

test("real template PNG assets have valid signatures and 1x/2x dimensions", () => {
  const assetRoot = join(projectRoot, "public", "build");
  assert.deepEqual(pngSize(join(assetRoot, TRAY_ICON_FILENAME)), {
    width: 18,
    height: 18,
  });
  assert.deepEqual(pngSize(join(assetRoot, "tray-iconTemplate@2x.png")), {
    width: 36,
    height: 36,
  });
});

test("tray source assets are trackable and packaging copies .output to Resources/web", () => {
  for (const asset of [
    "tray-iconTemplate.png",
    "tray-iconTemplate@2x.png",
    "tray-iconTemplate.svg",
  ]) {
    const ignored = spawnSync(
      "git",
      ["check-ignore", "--quiet", `public/build/${asset}`],
      { cwd: projectRoot },
    );
    assert.equal(ignored.status, 1, `${asset} must not be ignored by git`);
  }

  const builderConfig = readFileSync(
    join(projectRoot, "electron-builder.yml"),
    "utf8",
  );
  assert.match(
    builderConfig,
    /extraResources:\s*[\s\S]*?- from: \.output\s+to: web/u,
  );
  assert.doesNotMatch(builderConfig, /build\/tray-icon\.png/u);
});

test("development and packaged paths target their bundled public assets", () => {
  assert.equal(
    findTrayIconPath({
      isPackaged: false,
      resourcesPath: "/unused",
      appPath: projectRoot,
    }),
    join(projectRoot, "public", "build", TRAY_ICON_FILENAME),
  );
  const packagedPath = join(
    "/Applications/AITracker/Resources",
    "web",
    "public",
    "build",
    TRAY_ICON_FILENAME,
  );
  assert.equal(
    findTrayIconPath(
      {
        isPackaged: true,
        resourcesPath: "/Applications/AITracker/Resources",
        appPath: "/unused",
      },
      (candidate) => candidate === packagedPath,
    ),
    packagedPath,
  );
});

test("missing development icon falls back without a path warning", () => {
  assert.equal(
    findTrayIconPath({
      isPackaged: false,
      resourcesPath: "/tmp/resources",
      appPath: "/tmp/trusttools-no-build",
    }),
    null,
  );
});
