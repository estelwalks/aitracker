import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  APP_ICON_FILENAMES,
  findAppIconPath,
  findTrayIconPath,
  findTrayRetinaIconPath,
  MAC_TRAY_ICON_FILENAMES,
  TRAY_ICON_FILENAMES,
  WINDOWS_APP_ICON_FILENAMES,
  WINDOWS_TRAY_ICON_FILENAMES,
} from "./tray-icon.js";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

test("the canonical light and dark SVG assets are scalable square icons", () => {
  for (const filename of ["favicon.svg", "favicon-dark.svg"]) {
    const source = readFileSync(join(projectRoot, "public", filename), "utf8");
    assert.match(source, /^<svg[^>]+viewBox="0 0 1024 1024"/u);
  }
});

test("packaging uses the generated native containers and preserves runtime assets", () => {
  const builderConfig = readFileSync(
    join(projectRoot, "electron-builder.yml"),
    "utf8",
  );
  assert.match(builderConfig, /from: build\/native-icons\s+to: native-icons/u);
  assert.match(builderConfig, /icon: build\/native-icons\/icon\.icns/u);
  assert.match(builderConfig, /icon: build\/native-icons\/icon\.ico/u);
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

test("Windows development paths select the multi-resolution ICO", () => {
  for (const appearance of ["light", "dark"] as const) {
    const trayPath = join(
      projectRoot,
      "build",
      "native-icons",
      WINDOWS_TRAY_ICON_FILENAMES[appearance],
    );
    assert.equal(
      findTrayIconPath(
        {
          isPackaged: false,
          resourcesPath: "/unused",
          appPath: projectRoot,
          platform: "win32",
        },
        appearance,
        (candidate) => candidate === trayPath,
      ),
      trayPath,
    );
  }
});

test("macOS Retina paths resolve the 32×32 menu-bar icon next to 16px", () => {
  const retinaPath = join(
    projectRoot,
    "build",
    "native-icons",
    MAC_TRAY_ICON_FILENAMES.retina,
  );
  assert.equal(
    findTrayRetinaIconPath(
      {
        isPackaged: false,
        resourcesPath: "/unused",
        appPath: projectRoot,
      },
      (candidate) => candidate === retinaPath,
    ),
    retinaPath,
  );
});

test("macOS uses the same template mask for either appearance", () => {
  const input = {
    isPackaged: true,
    resourcesPath: "/Applications/AITracker.app/Contents/Resources",
    appPath: "/unused",
    platform: "darwin" as const,
  };
  const templatePath = join(
    input.resourcesPath,
    "native-icons",
    "trayTemplate.png",
  );
  for (const appearance of ["light", "dark"] as const) {
    assert.equal(
      findTrayIconPath(input, appearance, (path) => path === templatePath),
      templatePath,
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

test("Windows windows and taskbar resolve the same multi-resolution glyph as the tray", () => {
  for (const appearance of ["light", "dark"] as const) {
    const appIconPath = join(
      "C:\\Program Files\\AITracker\\resources",
      "native-icons",
      WINDOWS_APP_ICON_FILENAMES[appearance],
    );
    assert.equal(
      findAppIconPath(
        {
          isPackaged: true,
          resourcesPath: "C:\\Program Files\\AITracker\\resources",
          appPath: "/unused",
          platform: "win32",
        },
        appearance,
        (candidate) => candidate === appIconPath,
      ),
      appIconPath,
    );
  }
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

test("Windows startup uses a large PNG in the app appearance", () => {
  const input = {
    isPackaged: false,
    resourcesPath: "/unused",
    appPath: projectRoot,
    platform: "win32" as const,
    surface: "startup" as const,
  };
  const path = join(
    projectRoot,
    "build",
    "native-icons",
    APP_ICON_FILENAMES.light,
  );
  assert.equal(
    findAppIconPath(input, "light", (candidate) => candidate === path),
    path,
  );
});
