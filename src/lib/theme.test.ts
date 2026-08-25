import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_THEME, resolveThemeClass, themes } from "./theme.tsx";

test("default theme follows the system", () => {
  assert.equal(DEFAULT_THEME, "system");
});

test("theme options expose system, light, and dark in the settings order", () => {
  assert.deepEqual(
    themes.map((item) => item.id),
    ["system", "light", "dark"],
  );
});

test("system theme resolves to light when the OS prefers light", () => {
  assert.equal(resolveThemeClass("system", true), "theme-light");
  assert.equal(resolveThemeClass("system", false), "");
});

test("manual themes do not depend on the OS preference", () => {
  assert.equal(resolveThemeClass("light", false), "theme-light");
  assert.equal(resolveThemeClass("light", true), "theme-light");
  assert.equal(resolveThemeClass("dark", false), "");
  assert.equal(resolveThemeClass("dark", true), "");
});
