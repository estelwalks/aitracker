import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
  DEFAULT_WIDGET_PREFS,
  WIDGET_PREFS_STORAGE_KEY,
  __hydrateWidgetPrefsForTest,
  __resetWidgetPrefsModuleForTest,
  __setWidgetPreferencePersistenceForTest,
  readWidgetPrefs,
  resetWidgetPrefs,
  setWidgetPref,
  toneLine,
} from "./widget-prefs";

/**
 * widget-prefs 单测：SQLite preference port 读写 / 默认值 / 重置 / 语气改写。
 */

function createMemoryPersistence() {
  const store = new Map<string, string>();
  return {
    store,
    port: {
      get: async (key: string) => store.get(key),
      set: async (key: string, value: string) => {
        store.set(key, value);
      },
      remove: async (key: string) => store.delete(key),
    },
  };
}

let memory = createMemoryPersistence();

beforeEach(() => {
  memory = createMemoryPersistence();
  __setWidgetPreferencePersistenceForTest(memory.port);
  __resetWidgetPrefsModuleForTest();
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

test("setWidgetPref 写入内存并持久化到 SQLite preference port", async () => {
  __resetWidgetPrefsModuleForTest();
  await setWidgetPref("barStyle", "icon");
  await setWidgetPref("tone", "concise");
  await setWidgetPref("rotate", 30);

  assert.equal(readWidgetPrefs().barStyle, "icon");
  assert.equal(readWidgetPrefs().tone, "concise");
  assert.equal(readWidgetPrefs().rotate, 30);
  // 未修改的字段保持默认
  assert.equal(readWidgetPrefs().defaultTab, "today");

  const raw = memory.store.get(WIDGET_PREFS_STORAGE_KEY);
  assert.ok(raw != null);
  const stored = JSON.parse(raw) as Record<string, unknown>;
  assert.equal(stored.barStyle, "icon");
  assert.equal(stored.tone, "concise");
  assert.equal(stored.rotate, 30);
});

test("部分持久化数据与默认值合并", async () => {
  __resetWidgetPrefsModuleForTest();
  memory.store.set(
    WIDGET_PREFS_STORAGE_KEY,
    JSON.stringify({ barStyle: "icon-dot", tone: "off" }),
  );
  await __hydrateWidgetPrefsForTest();
  const prefs = readWidgetPrefs();
  assert.equal(prefs.barStyle, "icon-dot");
  assert.equal(prefs.tone, "off");
  assert.equal(prefs.defaultTab, DEFAULT_WIDGET_PREFS.defaultTab);
  assert.equal(prefs.rotate, DEFAULT_WIDGET_PREFS.rotate);
});

test("损坏的 JSON 回退到默认值", async () => {
  __resetWidgetPrefsModuleForTest();
  memory.store.set(WIDGET_PREFS_STORAGE_KEY, "{not-json");
  await __hydrateWidgetPrefsForTest();
  assert.deepEqual(readWidgetPrefs(), DEFAULT_WIDGET_PREFS);
});

test("resetWidgetPrefs 恢复默认并移除存储", async () => {
  __resetWidgetPrefsModuleForTest();
  await setWidgetPref("barStyle", "icon");
  assert.equal(readWidgetPrefs().barStyle, "icon");
  await resetWidgetPrefs();
  assert.deepEqual(readWidgetPrefs(), DEFAULT_WIDGET_PREFS);
  assert.equal(memory.store.get(WIDGET_PREFS_STORAGE_KEY), undefined);
});

test("toneLine 按语气返回对应文案", () => {
  assert.equal(toneLine("casual", "口语", "简洁"), "口语");
  assert.equal(toneLine("concise", "口语", "简洁"), "简洁");
  assert.equal(toneLine("off", "口语", "简洁"), "");
});
