import assert from "node:assert/strict";
import test from "node:test";

import {
  LOCALES,
  mapSystemCurrency,
  normalizeCurrency,
  resolveCurrencyFromSearch,
  mapSystemLocale,
  normalizeLocale,
  resolveLocale,
  resolveLocaleFromSearchParam,
  type Locale,
} from "./locale.ts";

test("LOCALES: 恰好四个受支持语言", () => {
  assert.deepEqual(LOCALES, ["zh-CN", "en-US", "ja-JP", "ko-KR"]);
});

test("normalizeLocale: 精确匹配四种 locale", () => {
  assert.equal(normalizeLocale("zh-CN"), "zh-CN");
  assert.equal(normalizeLocale("en-US"), "en-US");
  assert.equal(normalizeLocale("ja-JP"), "ja-JP");
  assert.equal(normalizeLocale("ko-KR"), "ko-KR");
});

test("normalizeLocale: 未知/大小写不符/空值返回 null", () => {
  assert.equal(normalizeLocale("fr-FR"), null);
  assert.equal(normalizeLocale("zh-cn"), null); // case-sensitive
  assert.equal(normalizeLocale(""), null);
  assert.equal(normalizeLocale(null), null);
  assert.equal(normalizeLocale(undefined), null);
});

test("mapSystemLocale: 主语言子标签映射(含 app.getLocale 与 BCP-47 形态)", () => {
  assert.equal(mapSystemLocale("zh"), "zh-CN");
  assert.equal(mapSystemLocale("zh-CN"), "zh-CN");
  assert.equal(mapSystemLocale("zh-Hans-CN"), "zh-CN");
  assert.equal(mapSystemLocale("zh_TW"), "zh-CN"); // 繁体也回退简体
  assert.equal(mapSystemLocale("en"), "en-US");
  assert.equal(mapSystemLocale("en-US"), "en-US");
  assert.equal(mapSystemLocale("en-GB"), "en-US");
  assert.equal(mapSystemLocale("ja"), "ja-JP");
  assert.equal(mapSystemLocale("ja-JP"), "ja-JP");
  assert.equal(mapSystemLocale("ko"), "ko-KR");
  assert.equal(mapSystemLocale("ko-KR"), "ko-KR");
});

test("mapSystemLocale: 未知语言永远回退 zh-CN", () => {
  assert.equal(mapSystemLocale("fr-FR"), "zh-CN");
  assert.equal(mapSystemLocale("de"), "zh-CN");
  assert.equal(mapSystemLocale(""), "zh-CN");
  assert.equal(mapSystemLocale(null), "zh-CN");
  assert.equal(mapSystemLocale(undefined), "zh-CN");
});

test("resolveLocale: 用户显式选择优先于系统语言", () => {
  assert.equal(resolveLocale("en-US", "zh-CN"), "en-US");
  assert.equal(resolveLocale("ja-JP", "ko-KR"), "ja-JP");
});

test("resolveLocale: 无用户选择时用系统语言", () => {
  assert.equal(resolveLocale(null, "en-US"), "en-US");
  assert.equal(resolveLocale(undefined, "ja-JP"), "ja-JP");
});

test("resolveLocaleFromSearchParam: 合法值解析, 非法值返回 null", () => {
  assert.equal(resolveLocaleFromSearchParam("en-US"), "en-US");
  assert.equal(resolveLocaleFromSearchParam("ko-KR"), "ko-KR");
  assert.equal(resolveLocaleFromSearchParam("fr-FR"), null);
  assert.equal(resolveLocaleFromSearchParam(""), null);
  assert.equal(resolveLocaleFromSearchParam(undefined), null);
  assert.equal(resolveLocaleFromSearchParam(42), null);
});

test("类型护栏: Locale 只能取自 LOCALES", () => {
  const l: Locale = "zh-CN";
  assert.ok(LOCALES.includes(l));
});

test("mapSystemCurrency: 四种界面语言映射到对应展示货币", () => {
  assert.equal(mapSystemCurrency("zh-CN"), "CNY");
  assert.equal(mapSystemCurrency("en-US"), "USD");
  assert.equal(mapSystemCurrency("ja-JP"), "JPY");
  assert.equal(mapSystemCurrency("ko-KR"), "KRW");
});

test("mapSystemCurrency: 系统 locale 的主语言标签也能映射, 未覆盖回退 USD", () => {
  assert.equal(mapSystemCurrency("zh"), "CNY");
  assert.equal(mapSystemCurrency("ja"), "JPY");
  assert.equal(mapSystemCurrency("en-GB"), "USD");
  assert.equal(mapSystemCurrency("fr-FR"), "USD");
  assert.equal(mapSystemCurrency(null), "USD");
});

test("normalizeCurrency: 精确匹配四币种, 非法值 null", () => {
  assert.equal(normalizeCurrency("CNY"), "CNY");
  assert.equal(normalizeCurrency("USD"), "USD");
  assert.equal(normalizeCurrency("JPY"), "JPY");
  assert.equal(normalizeCurrency("KRW"), "KRW");
  assert.equal(normalizeCurrency("EUR"), null);
  assert.equal(normalizeCurrency(42), null);
  assert.equal(normalizeCurrency(undefined), null);
});

test("resolveCurrencyFromSearch: ?currency= 校验与回退", () => {
  assert.equal(resolveCurrencyFromSearch({ currency: "JPY" }, "CNY"), "JPY");
  assert.equal(resolveCurrencyFromSearch({ currency: "EUR" }, "CNY"), "CNY");
  assert.equal(resolveCurrencyFromSearch({}, "USD"), "USD");
});
