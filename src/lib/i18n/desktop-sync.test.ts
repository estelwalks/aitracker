import assert from "node:assert/strict";
import test from "node:test";

import {
  applyDesktopLocaleEvent,
  applyDesktopPreferences,
  type DesktopI18nState,
} from "./desktop-sync.ts";

const initial: DesktopI18nState = {
  localeMode: "system",
  manualLocale: null,
  systemLocale: "zh-CN",
  currencyMode: "system",
  manualCurrency: null,
  systemCurrency: "CNY",
};

test("desktop preferences apply to renderer state without another write", () => {
  assert.deepEqual(
    applyDesktopPreferences(initial, {
      locale: "en-US",
      localeSource: "manual",
      displayCurrency: "USD",
      currencySource: "manual",
    }),
    {
      localeMode: "manual",
      manualLocale: "en-US",
      systemLocale: "zh-CN",
      currencyMode: "manual",
      manualCurrency: "USD",
      systemCurrency: "CNY",
    },
  );
});

test("desktop locale event immediately updates either renderer", () => {
  assert.deepEqual(applyDesktopLocaleEvent(initial, "ja-JP"), {
    ...initial,
    systemLocale: "ja-JP",
  });

  const manual = applyDesktopPreferences(initial, {
    locale: "en-US",
    localeSource: "manual",
    displayCurrency: "USD",
    currencySource: "manual",
  });
  assert.deepEqual(applyDesktopLocaleEvent(manual, "ko-KR"), {
    ...manual,
    manualLocale: "ko-KR",
  });
});
