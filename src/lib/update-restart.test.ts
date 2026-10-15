import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyUpdateRestart,
  updateRestartBodyKey,
} from "./update-restart.ts";

test("only a hand-off that really installs is reported as installing", () => {
  // macOS, Windows and a Linux AppImage all hand the work to another process.
  assert.deepEqual(
    classifyUpdateRestart({ started: true, method: "darwin-auto-install" }),
    { kind: "installing" },
  );
  assert.deepEqual(
    classifyUpdateRestart({ started: true, method: "linux-appimage-swap" }),
    { kind: "installing" },
  );
  assert.deepEqual(
    classifyUpdateRestart({ started: true, method: "windows-hidden" }),
    { kind: "installing" },
  );
  // A response without a method (older main process, or a browser preview) must
  // not be mistaken for a manual flow.
  assert.deepEqual(classifyUpdateRestart({ started: true }), {
    kind: "installing",
  });
});

test("a manual Linux hand-off is reported with the command that finishes it", () => {
  assert.deepEqual(
    classifyUpdateRestart({
      started: true,
      method: "linux-manual",
      installerPath:
        "/home/me/.config/AITracker/updates/aitracker-AITracker-Linux-x64.AppImage",
      manualCommand: "chmod +x '/path/aitracker-AITracker-Linux-x64.AppImage'",
    }),
    {
      kind: "manual",
      command: "chmod +x '/path/aitracker-AITracker-Linux-x64.AppImage'",
    },
  );
  // Without a command, the path is still better than claiming an install.
  assert.deepEqual(
    classifyUpdateRestart({
      started: true,
      method: "linux-manual",
      installerPath: "/tmp/AITracker-Linux-x64.AppImage",
    }),
    { kind: "manual", command: "/tmp/AITracker-Linux-x64.AppImage" },
  );
});

test("an unstarted hand-off is a failure and a package open is not an install", () => {
  assert.deepEqual(classifyUpdateRestart({ started: false }), {
    kind: "failed",
  });
  assert.deepEqual(
    classifyUpdateRestart({ started: true, method: "linux-package-open" }),
    { kind: "package-opened" },
  );
});

test("the restart copy follows the install form, not just the platform", () => {
  // Each flow gets the sentence that matches what the button really does.
  assert.equal(
    updateRestartBodyKey("darwin", null),
    "settings.updateRestartBodyMac",
  );
  assert.equal(
    updateRestartBodyKey("win32", null),
    "settings.updateRestartBody",
  );
  assert.equal(
    updateRestartBodyKey("linux", "appimage"),
    "settings.updateRestartBodyLinux",
  );
  // A deb/rpm or unpacked install cannot swap itself, so it must not read the
  // swap copy — that mismatch is what made the Linux deb flow look broken.
  assert.equal(
    updateRestartBodyKey("linux", "package"),
    "settings.updateRestartBodyLinuxManual",
  );
  assert.equal(
    updateRestartBodyKey("linux", "unpacked"),
    "settings.updateRestartBodyLinuxManual",
  );
  // Unknown install form: the conservative copy wins over a promise that may
  // not hold.
  assert.equal(
    updateRestartBodyKey("linux", null),
    "settings.updateRestartBodyLinuxManual",
  );
  // Platform not resolved yet (before getRuntimeInfo resolves): the Windows
  // copy is the generic one, and it is never the AppImage promise.
  assert.equal(updateRestartBodyKey(null, null), "settings.updateRestartBody");
});
