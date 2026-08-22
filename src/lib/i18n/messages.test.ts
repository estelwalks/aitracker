import assert from "node:assert/strict";
import test from "node:test";

import {
  catalogs,
  getMessage,
  loadCatalog,
  type Translations,
} from "./messages.ts";
import { LOCALES, type Locale } from "./locale.ts";

type Leaf = string | { one: string; other: string };

async function loadAllCatalogs(): Promise<void> {
  await Promise.all(LOCALES.map((locale) => loadCatalog(locale)));
}

function flatten(
  obj: Record<string, unknown>,
  prefix = "",
): Record<string, Leaf> {
  const out: Record<string, Leaf> = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value != null && typeof value === "object" && !Array.isArray(value)) {
      const isPlural =
        typeof (value as Record<string, unknown>).one === "string" &&
        typeof (value as Record<string, unknown>).other === "string";
      if (isPlural) {
        out[path] = value as Leaf;
      } else {
        Object.assign(out, flatten(value as Record<string, unknown>, path));
      }
    } else if (typeof value === "string") {
      out[path] = value;
    }
  }
  return out;
}

function placeholderSet(text: string): Set<string> {
  return new Set(
    [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] as string),
  );
}

test("四语言 key 集合完全一致", async () => {
  await loadAllCatalogs();
  const zhKeys = Object.keys(flatten(catalogs["zh-CN"])).sort();
  assert.ok(zhKeys.length > 20, `字典应至少 20 个 key,实际 ${zhKeys.length}`);
  for (const locale of LOCALES) {
    const keys = Object.keys(flatten(catalogs[locale])).sort();
    assert.deepEqual(keys, zhKeys, `${locale} key 集合与 zh-CN 不一致`);
  }
});

test("四语言 {var} 占位符集合一致(防翻译丢参数)", async () => {
  await loadAllCatalogs();
  for (const locale of LOCALES) {
    for (const [key, value] of Object.entries(flatten(catalogs[locale]))) {
      const expected = placeholderSet(
        typeof value === "string" ? value : value.one + value.other,
      );
      const zhValue = flatten(catalogs["zh-CN"])[key] as Leaf;
      const zhPlaceholders = placeholderSet(
        typeof zhValue === "string" ? zhValue : zhValue.one + zhValue.other,
      );
      assert.deepEqual(
        [...expected].sort(),
        [...zhPlaceholders].sort(),
        `${locale} key "${key}" 的占位符与 zh-CN 不一致`,
      );
    }
  }
});

test("四语言无空字符串/纯空格值", async () => {
  await loadAllCatalogs();
  for (const locale of LOCALES) {
    for (const [key, value] of Object.entries(flatten(catalogs[locale]))) {
      const text =
        typeof value === "string" ? value : `${value.one}${value.other}`;
      assert.ok(text.trim().length > 0, `${locale} key "${key}" 为空`);
    }
  }
});

test("getMessage: 无参数消息按当前语言解析", async () => {
  await loadAllCatalogs();
  assert.equal(getMessage(catalogs["zh-CN"], "nav.home"), "首页总览");
  assert.equal(getMessage(catalogs["en-US"], "nav.home"), "Home Overview");
  assert.equal(getMessage(catalogs["ja-JP"], "nav.home"), "ホーム概要");
  assert.equal(getMessage(catalogs["ko-KR"], "nav.home"), "홈 개요");
});

test("getMessage: {var} 插值(合成带参消息)", async () => {
  await loadAllCatalogs();
  const withParam = {
    ...catalogs["zh-CN"],
    common: { ...catalogs["zh-CN"].common, greeting: "你好，{name}！" },
  } as unknown as Translations;
  assert.equal(
    getMessage(withParam, "common.greeting", { name: "World" }),
    "你好，World！",
  );
});

test("getMessage: 当前语言缺失回退 zh-CN, zh 也缺失返回 key 路径", async () => {
  await loadAllCatalogs();
  // en-US 删掉 nav.home → 回退 zh
  const stripped = JSON.parse(JSON.stringify(catalogs["en-US"])) as Record<
    string,
    unknown
  >;
  (stripped.nav as Record<string, unknown>).home = undefined as never;
  delete (stripped.nav as Record<string, unknown>).home;
  assert.equal(
    getMessage(stripped as unknown as Translations, "nav.home"),
    "首页总览",
  );

  // zh 也没有 → 返回 key 路径
  assert.equal(
    getMessage(catalogs["zh-CN"] as Translations, "no.such.key"),
    "no.such.key",
  );
});

test("getMessage: 复数 {one, other} 按 count 选择(en-US)", async () => {
  await loadAllCatalogs();
  const en = catalogs["en-US"] as Translations;
  // 直接构造一个复数叶子消息验证选择逻辑
  const withPlural = {
    ...en,
    common: {
      ...(en.common as object),
      selected: { one: "1 item selected", other: "{count} items selected" },
    },
  } as unknown as Translations;
  assert.equal(
    getMessage(withPlural, "common.selected", { count: 1 }),
    "1 item selected",
  );
  assert.equal(
    getMessage(withPlural, "common.selected", { count: 2 }),
    "2 items selected",
  );
});

test("getMessage: 无参数 key 传参不影响结果", async () => {
  await loadAllCatalogs();
  assert.equal(
    getMessage(catalogs["zh-CN"], "nav.home", { count: 5 }),
    "首页总览",
  );
});

test("catalogs: 覆盖四种语言", async () => {
  await loadAllCatalogs();
  const locales = Object.keys(catalogs).sort();
  assert.deepEqual(locales, [...LOCALES].sort());
  for (const locale of LOCALES) {
    assert.ok(flatten(catalogs[locale as Locale])["nav.home"]);
  }
});
