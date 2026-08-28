import assert from "node:assert/strict";
import test from "node:test";

import { isReloadShortcut } from "./reload-shortcut.js";

test("recognizes desktop reload accelerators", () => {
  assert.equal(
    isReloadShortcut({ type: "keyDown", key: "r", meta: true }),
    true,
  );
  assert.equal(
    isReloadShortcut({ type: "keyDown", key: "R", control: true, shift: true }),
    true,
  );
  assert.equal(isReloadShortcut({ type: "keyDown", key: "F5" }), true);
});

test("does not block ordinary typing or key release", () => {
  assert.equal(isReloadShortcut({ type: "keyDown", key: "r" }), false);
  assert.equal(
    isReloadShortcut({ type: "keyDown", key: "r", alt: true }),
    false,
  );
  assert.equal(
    isReloadShortcut({ type: "keyUp", key: "r", meta: true }),
    false,
  );
});
