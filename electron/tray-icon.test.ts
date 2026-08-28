import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  APP_ICON_FILENAMES,
  findAppIconPath,
  findTrayIconPath,
  TRAY_ICON_FILENAMES,
} from "./tray-icon.js";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

test("the canonical light and dark SVG assets are scalable square icons", () => {
  for (const filename of ["favicon.svg", "favicon-dark.svg"]) {
    const source = readFileSync(join(projectRoot, "public", filename), "utf8");
    assert.match(source, /^<svg[^>]+viewBox="0 0 1024 1024"/u);
  }
});

test("packaging generates and preserves both native icon appearances", () => {
  const builderConfig = readFileSync(
    join(projectRoot, "electron-builder.yml"),
    "utf8",
  );
  const generator = readFileSync(
    join(projectRoot, "scripts", "generate-native-icons.mjs"),
    "utf8",
  );

  assert.match(builderConfig, /from: build\/native-icons\s+to: native-icons/u);
  assert.match(builderConfig, /icon: public\/favicon\.svg/u);
  for (const filename of [
    ...Object.values(TRAY_ICON_FILENAMES),
    ...Object.values(APP_ICON_FILENAMES),
  ]) {
    assert.match(generator, new RegExp(filename.replace(".", "\\."), "u"));
  }
});

test("development paths select light and dark generated icons", () => {
  for (const appearance of ["light", "dark"] as const) {
    const trayPath = join(
      projectRoot,
      "build",
      "native-icons",
      TRAY_ICON_FILENAMES[appearance],
    );
    assert.equal(
      findTrayIconPath(
        {
          isPackaged: false,
          resourcesPath: "/unused",
          appPath: projectRoot,
        },
        appearance,
        (candidate) => candidate === trayPath,
      ),
      trayPath,
    );
  }
});

test("packaged paths select the theme-aware app icon", () => {
  const packagedPath = join(
    "C:\\Program Files\\AITracker\\resources",
    "native-icons",
    APP_ICON_FILENAMES.dark,
  );
  assert.equal(
    findAppIconPath(
      {
        isPackaged: true,
        resourcesPath: "C:\\Program Files\\AITracker\\resources",
        appPath: "/unused",
      },
      "dark",
      (candidate) => candidate === packagedPath,
    ),
    packagedPath,
  );
});

test("missing generated icon returns null without a path warning", () => {
  assert.equal(
    findTrayIconPath(
      {
        isPackaged: false,
        resourcesPath: "/tmp/resources",
        appPath: "/tmp/aitracker-no-build",
      },
      "light",
    ),
    null,
  );
});
