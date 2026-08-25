import assert from "node:assert/strict";
import test from "node:test";

import {
  createMacWidgetTrayTemplate,
  createTrayTemplate,
  DESKTOP_CURRENCIES,
  DESKTOP_LOCALES,
  electronMessages,
  interpolate,
  mapAppLocale,
  mapSystemCurrency,
  normalizeDesktopCurrency,
  normalizeDesktopLocale,
  resolveDesktopLocale,
  resolveDesktopPreferences,
  type DesktopLocale,
} from "./i18n.js";
import { APP_NAME } from "./app-config.js";
import {
  CURRENCY_MODE_PREF_KEY,
  CURRENCY_PREF_KEY,
  LOCALE_MODE_PREF_KEY,
  LOCALE_PREF_KEY,
} from "./prefs.js";

test("electronMessages: 四个语言齐全且无空文案", () => {
  for (const locale of DESKTOP_LOCALES) {
    const catalog = electronMessages[locale];
    assert.ok(catalog.tray.tooltip.length > 0);
    assert.ok(catalog.menu.open.length > 0);
    assert.ok(catalog.menu.dashboard.length > 0);
    assert.ok(catalog.menu.settings.length > 0);
    assert.ok(catalog.menu.autoLaunch.length > 0);
    assert.ok(catalog.menu.quit.length > 0);
    assert.ok(catalog.dialog.closeHint.message.length > 0);
    assert.ok(catalog.dialog.closeHint.ok.length > 0);
    assert.ok(catalog.dialog.startupFailure.diagnosticCode.length > 0);
    for (const detail of Object.values(catalog.dialog.startupFailure.details)) {
      assert.ok(detail.length > 0);
    }
    assert.ok(catalog.dialog.dataIncompat.title.length > 0);
    assert.ok(catalog.dialog.dataIncompat.message.length > 0);
    assert.ok(catalog.dialog.dataIncompat.quit.length > 0);
    assert.ok(catalog.dialog.dataIncompat.clearAndContinue.length > 0);
  }
});

test("createMacWidgetTrayTemplate: 仅包含仪表盘、设置和退出", () => {
  let dashboardOpened = 0;
  let settingsOpened = 0;
  let quit = 0;
  const template = createMacWidgetTrayTemplate("zh-CN", {
    onOpenDashboard: () => dashboardOpened++,
    onOpenSettings: () => settingsOpened++,
    onQuit: () => quit++,
  });

  assert.equal(template.length, 4);
  assert.equal(template[0]?.label, "打开仪表盘");
  assert.equal(template[1]?.label, "进入设置");
  assert.equal(template[2]?.type, "separator");
  assert.equal(template[3]?.label, "退出");
  template.forEach((item) => item.click?.());
  assert.equal(dashboardOpened, 1);
  assert.equal(settingsOpened, 1);
  assert.equal(quit, 1);
});

test("electronMessages: 非中文文案允许在任意 UI 语言展示(品牌名不翻译)", () => {
  for (const locale of DESKTOP_LOCALES) {
    assert.equal(electronMessages[locale].tray.tooltip, APP_NAME);
  }
});

test("normalizeDesktopLocale: 精确匹配与非法值", () => {
  assert.equal(normalizeDesktopLocale("zh-CN"), "zh-CN");
  assert.equal(normalizeDesktopLocale("en-US"), "en-US");
  assert.equal(normalizeDesktopLocale("ja-JP"), "ja-JP");
  assert.equal(normalizeDesktopLocale("ko-KR"), "ko-KR");
  assert.equal(normalizeDesktopLocale("fr-FR"), null);
  assert.equal(normalizeDesktopLocale(""), null);
  assert.equal(normalizeDesktopLocale(undefined), null);
  assert.equal(normalizeDesktopLocale(42), null);
});

test("mapAppLocale: 系统语言主标签映射与未知回退", () => {
  assert.equal(mapAppLocale("zh"), "zh-CN");
  assert.equal(mapAppLocale("zh-CN"), "zh-CN");
  assert.equal(mapAppLocale("en"), "en-US");
  assert.equal(mapAppLocale("en-GB"), "en-US");
  assert.equal(mapAppLocale("ja"), "ja-JP");
  assert.equal(mapAppLocale("ja-JP"), "ja-JP");
  assert.equal(mapAppLocale("ko"), "ko-KR");
  assert.equal(mapAppLocale("ko-KR"), "ko-KR");
  assert.equal(mapAppLocale("de-DE"), "zh-CN");
  assert.equal(mapAppLocale(undefined), "zh-CN");
});

test("resolveDesktopLocale: 用户偏好 > 系统语言 > zh-CN", () => {
  assert.equal(
    resolveDesktopLocale({ [LOCALE_PREF_KEY]: "en-US" }, "ja-JP"),
    "en-US",
  );
  assert.equal(
    resolveDesktopLocale({ [LOCALE_PREF_KEY]: "ko-KR" }, "zh-CN"),
    "ko-KR",
  );
  assert.equal(resolveDesktopLocale({}, "en-US"), "en-US");
  assert.equal(resolveDesktopLocale({}, "ja"), "ja-JP");
  assert.equal(resolveDesktopLocale({}, "fr-FR"), "zh-CN");
  // 非法偏好值忽略,回退系统语言
  assert.equal(
    resolveDesktopLocale({ [LOCALE_PREF_KEY]: "fr-FR" }, "en-US"),
    "en-US",
  );
});

test("interpolate: {var} 占位替换, 缺失占位保留原样", () => {
  assert.equal(interpolate("v{oldVer} 数据", { oldVer: "9" }), "v9 数据");
  assert.equal(interpolate("a {x} b {y} c", { x: 1, y: 2 }), "a 1 b 2 c");
  assert.equal(interpolate("v{oldVer} 数据", {}), "v{oldVer} 数据");
  assert.equal(interpolate("no placeholders", { x: 1 }), "no placeholders");
});

test("createTrayTemplate: 结构正确且复选框状态保留", () => {
  const locale: DesktopLocale = "en-US";
  const template = createTrayTemplate(
    locale,
    {
      autoLaunchEnabled: true,
      autoLaunchSupported: true,
    },
    { onToggleAutoLaunch() {}, onQuit() {} },
  );
  assert.equal(template.length, 3);
  assert.equal(template[0]?.label, electronMessages["en-US"].menu.autoLaunch);
  assert.equal(template[0]?.type, "checkbox");
  assert.equal(template[0]?.checked, true);
  assert.equal(template[0]?.enabled, true);
  assert.equal(template[1]?.type, "separator");
  assert.equal(template[2]?.label, electronMessages["en-US"].menu.quit);
});

test("createTrayTemplate: 不支持自启时禁用复选框", () => {
  const template = createTrayTemplate(
    "zh-CN",
    {
      autoLaunchEnabled: false,
      autoLaunchSupported: false,
    },
    { onToggleAutoLaunch() {}, onQuit() {} },
  );
  assert.equal(template[0]?.enabled, false);
  assert.equal(template[0]?.checked, false);
});

test("createTrayTemplate: 点击回调接线正确", () => {
  let toggled: boolean | null = null;
  let quit = 0;
  createTrayTemplate(
    "zh-CN",
    {
      autoLaunchEnabled: true,
      autoLaunchSupported: true,
    },
    {
      onToggleAutoLaunch: (checked) => (toggled = checked),
      onQuit: () => quit++,
    },
  ).forEach((item) => item.click?.());
  assert.equal(toggled, false); // 从当前 enabled 反转
  assert.equal(quit, 1);
});

test("mapSystemCurrency: 系统 locale 地区映射与 USD 回退", () => {
  assert.equal(mapSystemCurrency("zh-CN"), "CNY");
  assert.equal(mapSystemCurrency("ja-JP"), "JPY");
  assert.equal(mapSystemCurrency("ko-KR"), "KRW");
  assert.equal(mapSystemCurrency("en-US"), "USD");
  assert.equal(mapSystemCurrency("fr-FR"), "USD");
  assert.equal(mapSystemCurrency(undefined), "USD");
});

test("normalizeDesktopCurrency: 精确匹配与非法值", () => {
  assert.equal(normalizeDesktopCurrency("CNY"), "CNY");
  assert.equal(normalizeDesktopCurrency("JPY"), "JPY");
  assert.equal(normalizeDesktopCurrency("EUR"), null);
  assert.equal(normalizeDesktopCurrency(undefined), null);
});

test("resolveDesktopPreferences: 语言与货币独立跟随系统/手动/回退", () => {
  // 无偏好 → 全部跟随系统
  const system = resolveDesktopPreferences({}, "ja-JP");
  assert.deepEqual(system, {
    locale: "ja-JP",
    localeSource: "system",
    displayCurrency: "JPY",
    currencySource: "system",
  });
  // 仅语言手动 → 货币仍跟随系统
  const mixed = resolveDesktopPreferences(
    { [LOCALE_MODE_PREF_KEY]: "manual", [LOCALE_PREF_KEY]: "en-US" },
    "ko-KR",
  );
  assert.equal(mixed.locale, "en-US");
  assert.equal(mixed.localeSource, "manual");
  assert.equal(mixed.displayCurrency, "KRW");
  assert.equal(mixed.currencySource, "system");
  // 货币手动 + 跟随系统语言
  const currencyManual = resolveDesktopPreferences(
    { [CURRENCY_MODE_PREF_KEY]: "manual", [CURRENCY_PREF_KEY]: "USD" },
    "zh-CN",
  );
  assert.equal(currencyManual.locale, "zh-CN");
  assert.equal(currencyManual.displayCurrency, "USD");
  assert.equal(currencyManual.currencySource, "manual");
  // 手动值非法 → 回退(不信任任意 prefs 值)
  const invalid = resolveDesktopPreferences(
    { [LOCALE_MODE_PREF_KEY]: "manual", [LOCALE_PREF_KEY]: "fr-FR" },
    "en-US",
  );
  assert.equal(invalid.locale, "en-US");
  assert.equal(invalid.localeSource, "fallback");
});

test("DESKTOP_CURRENCIES: 四种展示货币", () => {
  assert.deepEqual(DESKTOP_CURRENCIES, ["CNY", "USD", "JPY", "KRW"]);
});
