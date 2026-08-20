import assert from "node:assert/strict";
import test from "node:test";

import {
  CURRENCY_MODE_PREF_KEY,
  CURRENCY_PREF_KEY,
  LOCALE_MODE_PREF_KEY,
  LOCALE_PREF_KEY,
} from "./prefs.js";

test("desktop preference keys target the SQLite app_preferences namespace", () => {
  assert.deepEqual(
    [
      LOCALE_PREF_KEY,
      LOCALE_MODE_PREF_KEY,
      CURRENCY_PREF_KEY,
      CURRENCY_MODE_PREF_KEY,
    ],
    [
      "trusttools.locale",
      "trusttools.localeMode",
      "trusttools.displayCurrency",
      "trusttools.currencyMode",
    ],
  );
});
