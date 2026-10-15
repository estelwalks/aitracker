import assert from "node:assert/strict";
import { test } from "node:test";

import {
  NATIVE_WAYLAND_ENV,
  OZONE_PLATFORM_ARG,
  RELAUNCH_ENV_ASSIGNMENT,
  X11_RELAUNCH_ENV,
  consumeRelaunchEnvironment,
  planX11Relaunch,
  shouldPreferX11Backend,
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

test("the relaunch plan carries the environment as one surviving argument", () => {
  const base = {
    platform: "linux" as NodeJS.Platform,
    env: { ...WAYLAND_SESSION } as Record<string, string | undefined>,
    trayEnabled: true,
    xwaylandAvailable: () => true,
    argv: ["/opt/AITracker/aitracker"],
    inheritedEnvironment: {
      AITRACKER_TRAY_MENU_PROBE: "1",
      AITRACKER_TRAY_MENU_PROBE_REPORT: "/tmp/a dir/report.txt",
    },
  };
  const args = planX11Relaunch(base);
  assert.ok(args, "a Wayland session with a tray must plan a relaunch");
  assert.equal(args[0], OZONE_PLATFORM_ARG);

  // `app.relaunch()` consumes an unrecognised flag *and every argument after it*:
  // measured on Electron 43, a plan of ["--ozone-platform=x11", "--aitracker-env",
  // "AITRACKER_X=1"] reached the child as ["--ozone-platform=x11"]. The carried
  // variables therefore travel as a single assignment, which is not a flag. If this
  // ever becomes two tokens again, the settings silently stop arriving.
  const carried = args.filter((arg) => arg.startsWith("AITRACKER_"));
  assert.equal(
    carried.length,
    1,
    `exactly one carried argument, got ${carried.length}`,
  );
  assert.ok(carried[0].startsWith(`${RELAUNCH_ENV_ASSIGNMENT}=`), carried[0]);
  // No shell quoting is involved, so a value containing a space stays intact.
  assert.ok(!carried[0].includes("'"), "the payload must not be shell-quoted");

  // The child must read back exactly what was sent, and remove it from argv.
  const childArgv = ["/opt/AITracker/aitracker", ...args];
  const restored = consumeRelaunchEnvironment(childArgv);
  assert.equal(restored.AITRACKER_TRAY_MENU_PROBE, "1");
  assert.equal(
    restored.AITRACKER_TRAY_MENU_PROBE_REPORT,
    "/tmp/a dir/report.txt",
  );
  assert.equal(restored[X11_RELAUNCH_ENV], "1");
  assert.deepEqual(childArgv, ["/opt/AITracker/aitracker", OZONE_PLATFORM_ARG]);
});

test("a malformed relaunch payload injects nothing", () => {
  for (const payload of ["", "not-base64!!", "bnVsbA==", "WzEsMl0=", "e30="]) {
    const argv = [
      "/opt/AITracker/aitracker",
      `${RELAUNCH_ENV_ASSIGNMENT}=${payload}`,
    ];
    assert.deepEqual(
      consumeRelaunchEnvironment(argv),
      {},
      `payload ${payload} must not produce variables`,
    );
    // The marker is consumed either way, so it can never reach the app as an argument.
    assert.deepEqual(argv, ["/opt/AITracker/aitracker"]);
  }
});
