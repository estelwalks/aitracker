import assert from "node:assert/strict";
import test from "node:test";

import {
  fitBoundsToWorkArea,
  fitSizeToWorkArea,
  parseStoredWindowBounds,
  resolveMainWindowGeometry,
  resolveMainWindowSize,
} from "./main-window-size.js";

test("Windows main window uses the 1280×800 default", () => {
  assert.deepEqual(resolveMainWindowSize("win32"), {
    width: 1280,
    height: 800,
    minWidth: 891,
    minHeight: 583,
  });
});

test("macOS main window dimensions remain unchanged", () => {
  assert.deepEqual(resolveMainWindowSize("darwin"), {
    width: 1440,
    height: 940,
    minWidth: 1100,
    minHeight: 720,
  });
});

test("Linux keeps the shared default when the display is large enough", () => {
  assert.deepEqual(
    resolveMainWindowSize("linux", { width: 2560, height: 1440 }),
    {
      width: 1440,
      height: 940,
      minWidth: 1100,
      minHeight: 720,
    },
  );
});

test("a display smaller than the default shrinks the first-run window", () => {
  // 1366×768 is the common small-laptop panel; 1440×940 used to hang off it.
  assert.deepEqual(
    resolveMainWindowSize("linux", { width: 1366, height: 728 }),
    {
      width: 1366,
      height: 728,
      minWidth: 1100,
      minHeight: 720,
    },
  );
});

test("fitSizeToWorkArea never exceeds the work area or collapses completely", () => {
  assert.deepEqual(
    fitSizeToWorkArea(
      { width: 1440, height: 940 },
      { width: 800, height: 600 },
    ),
    { width: 800, height: 600 },
  );
  assert.deepEqual(
    fitSizeToWorkArea(
      { width: 320, height: 200 },
      { width: 1366, height: 768 },
    ),
    { width: 960, height: 640 },
  );
  // A degenerate work area must still produce a usable size rather than 0.
  assert.deepEqual(
    fitSizeToWorkArea({ width: 1440, height: 940 }, { width: 0, height: 0 }),
    { width: 1, height: 1 },
  );
});

test("fitBoundsToWorkArea keeps an off-screen stored window reachable", () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(
    fitBoundsToWorkArea({ x: 2400, y: 40, width: 1200, height: 800 }, workArea),
    { x: 720, y: 40, width: 1200, height: 800 },
  );
  assert.deepEqual(
    fitBoundsToWorkArea(
      { x: -900, y: -400, width: 1200, height: 800 },
      workArea,
    ),
    { x: 0, y: 0, width: 1200, height: 800 },
  );
});

test("fitBoundsToWorkArea honours a secondary display's origin", () => {
  const workArea = { x: 1920, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(
    fitBoundsToWorkArea({ x: 2000, y: 60, width: 1200, height: 800 }, workArea),
    { x: 2000, y: 60, width: 1200, height: 800 },
  );
});

test("parseStoredWindowBounds rejects anything a real window cannot produce", () => {
  assert.deepEqual(
    parseStoredWindowBounds({ x: 10, y: 20, width: 1200, height: 800 }),
    { x: 10, y: 20, width: 1200, height: 800 },
  );
  for (const value of [
    null,
    undefined,
    "1200x800",
    42,
    {},
    { x: 0, y: 0, width: 1200 },
    { x: 0, y: 0, width: "1200", height: 800 },
    { x: 0, y: 0, width: Number.NaN, height: 800 },
    // Smaller than the fitting floor: a truncated write, not a user choice.
    { x: 0, y: 0, width: 320, height: 800 },
    { x: 0, y: 0, width: 1200, height: 200 },
  ]) {
    assert.equal(parseStoredWindowBounds(value), null, String(value));
  }
});

test("first run sizes the window without pinning an origin", () => {
  const geometry = resolveMainWindowGeometry({
    platform: "darwin",
    stored: null,
    workArea: { x: 0, y: 25, width: 1440, height: 875 },
  });
  assert.deepEqual(geometry, {
    width: 1440,
    height: 875,
    minWidth: 1100,
    minHeight: 720,
  });
  assert.equal("x" in geometry, false);
  assert.equal("y" in geometry, false);
});

test("a stored rectangle is restored and clamped to the current display", () => {
  const geometry = resolveMainWindowGeometry({
    platform: "linux",
    stored: { x: 100, y: 80, width: 1200, height: 800 },
    workArea: { x: 0, y: 0, width: 1366, height: 768 },
  });
  assert.deepEqual(geometry, {
    x: 100,
    y: 0,
    // Height is clamped first, so the bottom edge stays inside the work area.
    width: 1200,
    height: 768,
    minWidth: 1100,
    minHeight: 720,
  });
});
