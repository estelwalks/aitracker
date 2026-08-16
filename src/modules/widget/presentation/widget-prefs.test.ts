import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import {
  DEFAULT_WIDGET_PREFS,
  WIDGET_PREFS_STORAGE_KEY,
  __resetWidgetPrefsModuleForTest,
  readWidgetPrefs,
  resetWidgetPrefs,
  setWidgetPref,
  toneLine,
} from "./widget-prefs";

/**
 * widget-prefs 单测：localStorage 读写 / 默认值 / 重置 / 语气改写。
 * 用内存版 localStorage 替换 globalThis.localStorage（node 环境无 window）。
 */

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  };
}

let originalStorage: Storage | undefined;

before(() => {
  originalStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: createMemoryStorage(),
  });
});

after(() => {
  if (originalStorage === undefined) {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  } else {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: originalStorage,
    });
  }
});

test("未持久化时返回默认值", () => {
  __resetWidgetPrefsModuleForTest();
  assert.deepEqual(readWidgetPrefs(), DEFAULT_WIDGET_PREFS);
  assert.equal(readWidgetPrefs().barStyle, "icon-num");
  assert.equal(readWidgetPrefs().defaultTab, "today");
  assert.equal(readWidgetPrefs().tone, "casual");
  assert.equal(readWidgetPrefs().rotate, 10);
  assert.equal(readWidgetPrefs().widgetTheme, "dark");
});

test("setWidgetPref 写入内存并持久化到 localStorage", () => {
  __resetWidgetPrefsModuleForTest();
  setWidgetPref("barStyle", "icon");
  setWidgetPref("tone", "concise");
  setWidgetPref("rotate", 30);

  assert.equal(readWidgetPrefs().barStyle, "icon");
  assert.equal(readWidgetPrefs().tone, "concise");
  assert.equal(readWidgetPrefs().rotate, 30);
  // 未修改的字段保持默认
  assert.equal(readWidgetPrefs().defaultTab, "today");

  const raw = globalThis.localStorage.getItem(WIDGET_PREFS_STORAGE_KEY);
  assert.ok(raw != null);
  const stored = JSON.parse(raw) as Record<string, unknown>;
  assert.equal(stored.barStyle, "icon");
  assert.equal(stored.tone, "concise");
  assert.equal(stored.rotate, 30);
});

test("部分持久化数据与默认值合并", () => {
  __resetWidgetPrefsModuleForTest();
  globalThis.localStorage.setItem(
    WIDGET_PREFS_STORAGE_KEY,
    JSON.stringify({ barStyle: "icon-dot", tone: "off" }),
  );
  // 重新水合：读取的是持久化数据与默认值的合并结果
  const prefs = readWidgetPrefs();
  assert.equal(prefs.barStyle, "icon-dot");
  assert.equal(prefs.tone, "off");
  assert.equal(prefs.defaultTab, DEFAULT_WIDGET_PREFS.defaultTab);
  assert.equal(prefs.rotate, DEFAULT_WIDGET_PREFS.rotate);
});

test("损坏的 JSON 回退到默认值", () => {
  __resetWidgetPrefsModuleForTest();
  globalThis.localStorage.setItem(WIDGET_PREFS_STORAGE_KEY, "{not-json");
  assert.deepEqual(readWidgetPrefs(), DEFAULT_WIDGET_PREFS);
});

test("resetWidgetPrefs 恢复默认并移除存储", () => {
  __resetWidgetPrefsModuleForTest();
  setWidgetPref("barStyle", "icon");
  assert.equal(readWidgetPrefs().barStyle, "icon");
  resetWidgetPrefs();
  assert.deepEqual(readWidgetPrefs(), DEFAULT_WIDGET_PREFS);
  assert.equal(globalThis.localStorage.getItem(WIDGET_PREFS_STORAGE_KEY), null);
});

test("toneLine 按语气返回对应文案", () => {
  assert.equal(toneLine("casual", "口语", "简洁"), "口语");
  assert.equal(toneLine("concise", "口语", "简洁"), "简洁");
  assert.equal(toneLine("off", "口语", "简洁"), "");
});
