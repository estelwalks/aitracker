import assert from "node:assert/strict";
import test from "node:test";

import { shouldAwaitStartupCollectors } from "./desktop-startup-policy.ts";

test("Windows never blocks first paint on startup collectors", () => {
  assert.equal(shouldAwaitStartupCollectors("win32"), false);
});

test("macOS retains the existing strict startup barrier", () => {
  assert.equal(shouldAwaitStartupCollectors("darwin"), true);
});
