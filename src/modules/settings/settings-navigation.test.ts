import assert from "node:assert/strict";
import test from "node:test";

import {
  SETTINGS_CATEGORIES,
  parseSettingsSection,
  resolveSettingsCategory,
} from "./settings-navigation";

test("设置分类收敛为五个面向用户的类别", () => {
  assert.deepEqual(SETTINGS_CATEGORIES, [
    "preferences",
    "scan",
    "model",
    "data",
    "about",
  ]);
});

test("设置深链支持 scan、model 和 menu-bar-app", () => {
  assert.equal(parseSettingsSection("scan"), "scan");
  assert.equal(parseSettingsSection("model"), "model");
  assert.equal(parseSettingsSection("menu-bar-app"), "menu-bar-app");
  assert.equal(parseSettingsSection("unknown"), undefined);

  assert.equal(resolveSettingsCategory(undefined), "preferences");
  assert.equal(resolveSettingsCategory("scan"), "scan");
  assert.equal(resolveSettingsCategory("model"), "model");
  assert.equal(resolveSettingsCategory("menu-bar-app"), "preferences");
});
