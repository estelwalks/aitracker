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

test("tray fallback is an inline PNG data URL", () => {
  assert.match(TRAY_ICON_DATA_URL, /^data:image\/png;base64,/u);
  const png = Buffer.from(
    TRAY_ICON_DATA_URL.replace("data:image/png;base64,", ""),
    "base64",
  );
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test("the shared tray logo is a valid application icon asset", () => {
  assert.deepEqual(
    pngSize(
      join(
        projectRoot,
        "public",
        "brand-logos",
        "ai-tracker",
        TRAY_ICON_FILENAME,
      ),
    ),
    { width: 1024, height: 1024 },
  );
});

test("the fallback is still a valid PNG", () => {
  const png = Buffer.from(
    TRAY_ICON_DATA_URL.replace("data:image/png;base64,", ""),
    "base64",
  );
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.deepEqual(
    { width: png.readUInt32BE(16), height: png.readUInt32BE(20) },
    { width: 16, height: 16 },
  );
});

test("packaging preserves the shared tray logo and removes template resources", () => {
  const ignored = spawnSync(
    "git",
    [
      "check-ignore",
      "--quiet",
      `public/brand-logos/ai-tracker/${TRAY_ICON_FILENAME}`,
    ],
    { cwd: projectRoot },
  );
  assert.equal(ignored.status, 1, "the tray logo must not be ignored by git");

  const builderConfig = readFileSync(
    join(projectRoot, "electron-builder.yml"),
    "utf8",
  );
  assert.match(
    builderConfig,
    /from: public\/brand-logos\/ai-tracker\/ai-tracker-icon-app\.png\s+to: tray\/ai-tracker-icon-app\.png/u,
  );
  assert.doesNotMatch(builderConfig, /tray-iconTemplate/u);
  assert.match(
    builderConfig,
    /extraResources:\s*[\s\S]*?- from: \.output\s+to: web/u,
  );
});

test("development and packaged paths target the shared tray logo", () => {
  const developmentPath = join(
    projectRoot,
    "public",
    "brand-logos",
    "ai-tracker",
    TRAY_ICON_FILENAME,
  );
  assert.equal(
    findTrayIconPath({
      isPackaged: false,
      resourcesPath: "/unused",
      appPath: projectRoot,
    }),
    developmentPath,
  );
  const packagedPath = join(
    "C:\\Program Files\\AITracker\\resources",
    "tray",
    TRAY_ICON_FILENAME,
  );
  assert.equal(
    findTrayIconPath(
      {
        isPackaged: true,
        resourcesPath: "C:\\Program Files\\AITracker\\resources",
        appPath: "/unused",
      },
      (candidate) => candidate === packagedPath,
    ),
    packagedPath,
  );
});

test("missing development logo falls back without a path warning", () => {
  assert.equal(
    findTrayIconPath({
      isPackaged: false,
      resourcesPath: "/tmp/resources",
      appPath: "/tmp/aitracker-no-build",
    }),
    null,
  );
});
