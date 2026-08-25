import assert from "node:assert/strict";
import test from "node:test";

import { resolveMainWindowSize } from "./main-window-size.js";

test("Windows main window dimensions are reduced by one quarter", () => {
  assert.deepEqual(resolveMainWindowSize("win32"), {
    width: 1080,
    height: 705,
    minWidth: 825,
    minHeight: 540,
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
