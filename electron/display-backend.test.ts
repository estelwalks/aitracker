import assert from "node:assert/strict";
import { test } from "node:test";

import {
  NATIVE_WAYLAND_ENV,
  OZONE_PLATFORM_ARG,
  X11_RELAUNCH_ENV,
  shouldPreferX11Backend,
  x11RelaunchArgs,
  xwaylandLooksAvailable,
} from "./display-backend.js";

const WAYLAND_SESSION = {
  XDG_SESSION_TYPE: "wayland",
  WAYLAND_DISPLAY: "wayland-0",
  DISPLAY: ":0",
};

function decide(
  env: Record<string, string | undefined>,
  options: { trayEnabled?: boolean; xwayland?: boolean } = {},
) {
  return shouldPreferX11Backend({
    platform: "linux",
    env,
    trayEnabled: options.trayEnabled ?? true,
    xwaylandAvailable: () => options.xwayland ?? true,
  });
}

test("a Wayland session with a tray and XWayland downgrades to X11", () => {
  // Measured: under Wayland Electron never creates the tray window at all, while
  // under XWayland it appears in the panel strip within 2s and is clickable.
  assert.equal(decide(WAYLAND_SESSION), true);
});

test("an X11 session is left alone", () => {
  assert.equal(decide({ XDG_SESSION_TYPE: "x11", DISPLAY: ":0" }), false);
  assert.equal(decide({ DISPLAY: ":0" }), false);
});

test("no tray means no reason to downgrade", () => {
  assert.equal(decide(WAYLAND_SESSION, { trayEnabled: false }), false);
});

test("AITRACKER_NATIVE_WAYLAND opts out", () => {
  for (const value of ["1", "true", "TRUE", "yes", " yes "]) {
    assert.equal(
      decide({ ...WAYLAND_SESSION, [NATIVE_WAYLAND_ENV]: value }),
      false,
      value,
    );
  }
  // Anything else is not an opt-out, so the tray keeps working by default.
  for (const value of ["", "0", "false", "no", "maybe"]) {
    assert.equal(
      decide({ ...WAYLAND_SESSION, [NATIVE_WAYLAND_ENV]: value }),
      true,
      value,
    );
  }
});

test("no XWayland means do not force X11", () => {
  // Forcing X11 without an X server leaves the app unable to open a window,
  // which is worse than a missing tray icon.
  assert.equal(decide(WAYLAND_SESSION, { xwayland: false }), false);
});

test("macOS and Windows never take this path", () => {
  for (const platform of ["darwin", "win32"] as NodeJS.Platform[]) {
    assert.equal(
      shouldPreferX11Backend({
        platform,
        env: WAYLAND_SESSION,
        trayEnabled: true,
        xwaylandAvailable: () => true,
      }),
      false,
    );
  }
});

test("WAYLAND_DISPLAY alone is enough to spot a Wayland session", () => {
  assert.equal(decide({ WAYLAND_DISPLAY: "wayland-1" }), true);
  assert.equal(decide({ WAYLAND_DISPLAY: "  " }), false);
});

test("XWayland availability needs a real socket, not just DISPLAY", () => {
  const existing = new Set(["/tmp/.X11-unix/X0", "/usr/bin/Xwayland"]);
  const fileExists = (path: string) => existing.has(path);

  assert.equal(xwaylandLooksAvailable({ DISPLAY: ":0" }, fileExists), true);
  // A stale DISPLAY whose socket is gone falls back to the binary check, which
  // still passes because Xwayland is installed.
  assert.equal(xwaylandLooksAvailable({ DISPLAY: ":9" }, fileExists), true);
  // Neither a usable socket nor the binary: do not claim X11 works.
  assert.equal(
    xwaylandLooksAvailable({ DISPLAY: ":9" }, (p) => p === "/tmp/.X11-unix/X0"),
    false,
  );
  // A DISPLAY that is not a local screen number is not evidence either.
  assert.equal(
    xwaylandLooksAvailable({ DISPLAY: "host:0" }, () => false),
    false,
  );
});

test("an X11 relaunch is requested exactly once", () => {
  const base = {
    platform: "linux" as NodeJS.Platform,
    env: { ...WAYLAND_SESSION } as Record<string, string | undefined>,
    trayEnabled: true,
    xwaylandAvailable: () => true,
    argv: ["/opt/AITracker/aitracker"],
  };
  assert.deepEqual(x11RelaunchArgs(base), [OZONE_PLATFORM_ARG]);

  // The replacement process carries the argument, so it must not relaunch again
  // or the two instances would restart each other forever. The guard covers the
  // case where the argument is somehow absent.
  assert.equal(
    x11RelaunchArgs({ ...base, argv: [base.argv[0], OZONE_PLATFORM_ARG] }),
    null,
  );
  assert.equal(
    x11RelaunchArgs({
      ...base,
      env: { ...base.env, [X11_RELAUNCH_ENV]: "1" },
    }),
    null,
  );
  // An explicit --ozone-platform choice from the user is never overridden.
  assert.equal(
    x11RelaunchArgs({
      ...base,
      argv: [base.argv[0], "--ozone-platform=wayland"],
    }),
    null,
  );
  // Nothing to do when the conditions for X11 are absent.
  assert.equal(x11RelaunchArgs({ ...base, trayEnabled: false }), null);
  assert.equal(
    x11RelaunchArgs({ ...base, xwaylandAvailable: () => false }),
    null,
  );
  assert.equal(x11RelaunchArgs({ ...base, platform: "darwin" }), null);
});
