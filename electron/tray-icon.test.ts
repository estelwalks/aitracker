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

function pngDensity(path: string): { x: number; y: number; unit: number } {
  const bytes = readFileSync(path);
  let offset = 8;
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    if (type === "pHYs") {
      return {
        x: bytes.readUInt32BE(offset + 8),
        y: bytes.readUInt32BE(offset + 12),
        unit: bytes[offset + 16],
      };
    }
    offset += length + 12;
  }
  throw new Error(`${path} is missing a pHYs density chunk`);
}

test("tray fallback is an inline PNG data URL", () => {
  assert.match(TRAY_ICON_DATA_URL, /^data:image\/png;base64,/u);
  const png = Buffer.from(
    TRAY_ICON_DATA_URL.replace("data:image/png;base64,", ""),
    "base64",
  );
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test("real template PNG assets have valid signatures and 1x/2x dimensions", () => {
  const assetRoot = join(projectRoot, "public", "build");
  assert.deepEqual(pngSize(join(assetRoot, TRAY_ICON_FILENAME)), {
    width: 16,
    height: 16,
  });
  assert.deepEqual(pngSize(join(assetRoot, "tray-iconTemplate@2x.png")), {
    width: 32,
    height: 32,
  });
  // Electron's macOS Tray guidance specifies 144 dpi for the Retina image.
  assert.deepEqual(pngDensity(join(assetRoot, "tray-iconTemplate@2x.png")), {
    x: 5669,
    y: 5669,
    unit: 1,
  });
});

test("tray source assets are trackable and packaging preserves the native pair", () => {
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
    /extraResources:\s*[\s\S]*?- from: public\/build\s+to: tray[\s\S]*?tray-iconTemplate\.png[\s\S]*?tray-iconTemplate@2x\.png/u,
  );
  assert.match(
    builderConfig,
    /extraResources:\s*[\s\S]*?- from: \.output\s+to: web/u,
  );
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
    "tray",
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
      appPath: "/tmp/aitracker-no-build",
    }),
    null,
  );
});
