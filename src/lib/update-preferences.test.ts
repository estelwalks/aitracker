import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_AUTO_UPDATE_ENABLED,
  parseAutoUpdateEnabled,
} from "./update-preferences.ts";

test("automatic updates are enabled by default", () => {
  assert.equal(DEFAULT_AUTO_UPDATE_ENABLED, true);
  assert.equal(parseAutoUpdateEnabled(undefined), true);
  assert.equal(parseAutoUpdateEnabled("not-json"), true);
});

test("only an explicit false disables automatic updates", () => {
  assert.equal(parseAutoUpdateEnabled(false), false);
  assert.equal(parseAutoUpdateEnabled("false"), false);
  assert.equal(parseAutoUpdateEnabled(JSON.stringify(false)), false);
  assert.equal(parseAutoUpdateEnabled(true), true);
  assert.equal(parseAutoUpdateEnabled("0"), true);
});
