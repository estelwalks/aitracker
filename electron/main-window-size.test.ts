import assert from "node:assert/strict";
import test from "node:test";

import { resolveMainWindowSize } from "./main-window-size.js";

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
