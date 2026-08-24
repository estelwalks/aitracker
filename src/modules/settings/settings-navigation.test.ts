import assert from "node:assert/strict";
import test from "node:test";

import {
  SETTINGS_CATEGORIES,
  parseSettingsSection,
  resolveSettingsCategory,
} from "./settings-navigation";

test("菜单栏 APP 是独立设置分类", () => {
  assert.ok(SETTINGS_CATEGORIES.includes("menuBarApp"));
  assert.notEqual(
    SETTINGS_CATEGORIES.indexOf("menuBarApp"),
    SETTINGS_CATEGORIES.indexOf("general"),
  );
});

test("设置深链支持 scan、model 和 menu-bar-app", () => {
  assert.equal(parseSettingsSection("scan"), "scan");
  assert.equal(parseSettingsSection("model"), "model");
  assert.equal(parseSettingsSection("menu-bar-app"), "menu-bar-app");
  assert.equal(parseSettingsSection("unknown"), undefined);

  assert.equal(resolveSettingsCategory(undefined), "general");
  assert.equal(resolveSettingsCategory("scan"), "scan");
  assert.equal(resolveSettingsCategory("model"), "model");
  assert.equal(resolveSettingsCategory("menu-bar-app"), "menuBarApp");
});
