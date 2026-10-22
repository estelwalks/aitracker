import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import {
  cursorAccountPlatform,
  resolveCursorAccountPaths,
} from "./paths.server.ts";

const HOME = "/fixture-home";

test("windows resolves Cursor under the roaming AppData directory", () => {
  const paths = resolveCursorAccountPaths({
    homeDirectory: HOME,
    platform: "windows",
  });
  assert.equal(paths.appDir, join(HOME, "AppData", "Roaming", "Cursor"));
  assert.equal(
    paths.stateDatabasePath,
    join(
      HOME,
      "AppData",
      "Roaming",
      "Cursor",
      "User",
      "globalStorage",
      "state.vscdb",
    ),
  );
  assert.equal(paths.cliConfigPath, join(HOME, ".cursor", "cli-config.json"));
});

test("macos resolves Cursor under Application Support", () => {
  const paths = resolveCursorAccountPaths({
    homeDirectory: HOME,
    platform: "macos",
  });
  assert.equal(
    paths.appDir,
    join(HOME, "Library", "Application Support", "Cursor"),
  );
});

test("linux resolves Cursor under the XDG config home", () => {
  assert.equal(
    resolveCursorAccountPaths({ homeDirectory: HOME, platform: "linux" })
      .appDir,
    join(HOME, ".config", "Cursor"),
  );
  assert.equal(
    resolveCursorAccountPaths({
      homeDirectory: HOME,
      platform: "linux",
      env: { XDG_CONFIG_HOME: "/fixture-xdg" },
    }).appDir,
    join("/fixture-xdg", "Cursor"),
  );
});

test("the cache lives under the AITracker data root on every platform", () => {
  for (const platform of ["macos", "windows", "linux"] as const) {
    const paths = resolveCursorAccountPaths({
      homeDirectory: HOME,
      platform,
    });
    assert.equal(
      paths.cachePath,
      join(HOME, ".aitracker", "data", "cursor-account-usage", "usage.json"),
    );
  }
});

test("omitting the platform follows the current process, never macOS", () => {
  // Regression: the scheduler, the Settings status and the manual sync used to
  // omit the platform, so a Windows install probed the macOS directory, was
  // judged "not installed" and never collected anything.
  assert.equal(
    resolveCursorAccountPaths({ homeDirectory: HOME }).appDir,
    resolveCursorAccountPaths({
      homeDirectory: HOME,
      platform: cursorAccountPlatform(process.platform),
    }).appDir,
  );
  assert.equal(cursorAccountPlatform("win32"), "windows");
  assert.equal(cursorAccountPlatform("darwin"), "macos");
  assert.equal(cursorAccountPlatform("linux"), "linux");
});
