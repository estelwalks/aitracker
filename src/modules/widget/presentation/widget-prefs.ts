import { useCallback, useEffect, useSyncExternalStore } from "react";

import {
  getPreference,
  removePreference,
  setPreference,
  type PreferenceValue,
} from "../../../lib/preferences/client.ts";

/**
 * 小组件配置偏好（SQLite app_preferences 独立 key）。
 *
 * 移植自原型 `src/lib/widget-prefs.ts` 的结构与 API：
 * `useWidgetPrefs` / `setWidgetPref` / `resetWidgetPrefs`；与原型不同，
 * 本项目的 Tab 为 安全/用量/今日，且不依赖原型 mock 库。
 */

/** 菜单栏图标样式 */
export type MenuBarStyle = "icon" | "icon-num" | "icon-dot";
/** 点击菜单栏图标的行为 */
export type MenuBarClick = "panel" | "main";
/** 浮窗三 Tab：安全 / 用量 / 今日 */
export type WidgetTab = "safety" | "usage" | "today";
/** 打开浮窗时的默认 Tab；"last" 表示恢复上次关闭的 */
export type DefaultTab = WidgetTab | "last";
/** 贾维斯语气：口语化 / 简洁 / 关闭（不显示文案） */
export type Tone = "casual" | "concise" | "off";
/** 轮播间隔（秒）；0 = 手动切换 */
export type Rotate = 5 | 10 | 30 | 0;
/** 小号桌面小组件内容 */
export type SmallContent = "orb" | "safety";
/** 中号桌面小组件内容 */
export type MediumContent = "brief" | "today" | "waste" | "safety";
/** 小组件颜色主题 */
export type WidgetTheme = "dark" | "system";
export interface WidgetPrefs {
  menuBarEnabled: boolean;
  barStyle: MenuBarStyle;
  barClick: MenuBarClick;
  defaultTab: DefaultTab;
  lastTab: WidgetTab;
  tone: Tone;
  rotate: Rotate;
  smallContent: SmallContent;
  mediumContent: MediumContent;
  widgetTheme: WidgetTheme;
}

export const DEFAULT_WIDGET_PREFS: WidgetPrefs = {
  menuBarEnabled: true,
  barStyle: "icon-num",
  barClick: "panel",
  defaultTab: "today",
  lastTab: "today",
  tone: "casual",
  rotate: 10,
  smallContent: "orb",
  mediumContent: "brief",
  widgetTheme: "dark",
};

export const WIDGET_PREFS_STORAGE_KEY = "tt-widget-prefs";

let state: WidgetPrefs = DEFAULT_WIDGET_PREFS;
let hydrated = false;
let hydration: Promise<void> | null = null;
let persistenceWrite: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();
interface WidgetPreferencePersistence {
  get(key: string): Promise<unknown>;
  set(key: string, value: PreferenceValue): Promise<void>;
  remove(key: string): Promise<boolean>;
}
let persistence: WidgetPreferencePersistence = {
  get: getPreference,
  set: setPreference,
  remove: removePreference,
};

function parseStored(value: unknown): WidgetPrefs {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return DEFAULT_WIDGET_PREFS;
    }
  }
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_WIDGET_PREFS;
  }
  const parsed = value as Partial<WidgetPrefs>;
  // 只取已知字段，避免脏数据污染；未知字段被丢弃。
  return {
    ...DEFAULT_WIDGET_PREFS,
    ...(typeof parsed.menuBarEnabled === "boolean"
      ? { menuBarEnabled: parsed.menuBarEnabled }
      : {}),
    ...(typeof parsed.barStyle === "string"
      ? { barStyle: parsed.barStyle }
      : {}),
    ...(typeof parsed.barClick === "string"
      ? { barClick: parsed.barClick }
      : {}),
    ...(typeof parsed.defaultTab === "string"
      ? { defaultTab: parsed.defaultTab }
      : {}),
    ...(typeof parsed.lastTab === "string" ? { lastTab: parsed.lastTab } : {}),
    ...(typeof parsed.tone === "string" ? { tone: parsed.tone } : {}),
    ...(typeof parsed.rotate === "number" ? { rotate: parsed.rotate } : {}),
    ...(typeof parsed.smallContent === "string"
      ? { smallContent: parsed.smallContent }
      : {}),
    ...(typeof parsed.mediumContent === "string"
      ? { mediumContent: parsed.mediumContent }
      : {}),
    ...(typeof parsed.widgetTheme === "string"
      ? { widgetTheme: parsed.widgetTheme }
      : {}),
  };
}

function ensureHydrated(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (hydration) return hydration;
  hydration = persistence.get(WIDGET_PREFS_STORAGE_KEY).then((stored) => {
    state = parseStored(stored);
    hydrated = true;
    emit();
  });
  return hydration;
}

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  void ensureHydrated();
  return () => {
    listeners.delete(listener);
  };
}

/** 读取当前内存中的偏好；React 订阅建立后从 SQLite 水合。 */
export function readWidgetPrefs(): WidgetPrefs {
  return state;
}

export function setWidgetPref<K extends keyof WidgetPrefs>(
  key: K,
  value: WidgetPrefs[K],
): Promise<void> {
  state = { ...state, [key]: value };
  emit();
  const persisted = { ...state } as unknown as PreferenceValue;
  persistenceWrite = persistenceWrite
    .catch(() => undefined)
    .then(() => persistence.set(WIDGET_PREFS_STORAGE_KEY, persisted));
  return persistenceWrite;
}

export async function resetWidgetPrefs(): Promise<void> {
  state = DEFAULT_WIDGET_PREFS;
  emit();
  persistenceWrite = persistenceWrite
    .catch(() => undefined)
    .then(async () => {
      await persistence.remove(WIDGET_PREFS_STORAGE_KEY);
    });
  await persistenceWrite;
}

/**
 * 仅测试使用：清空模块内存态并强制下次读取重新水合，
 * 使持久化水合用例可独立验证。
 */
export function __resetWidgetPrefsModuleForTest(): void {
  state = DEFAULT_WIDGET_PREFS;
  hydrated = false;
  hydration = null;
  persistenceWrite = Promise.resolve();
  listeners.clear();
}

export function __setWidgetPreferencePersistenceForTest(
  next: WidgetPreferencePersistence,
): void {
  persistence = next;
}

export async function __hydrateWidgetPrefsForTest(): Promise<void> {
  await ensureHydrated();
}

/** 响应式读取小组件偏好（服务端渲染返回默认值）。 */
export function useWidgetPrefs(): {
  prefs: WidgetPrefs;
  hydrated: boolean;
  set: <K extends keyof WidgetPrefs>(
    key: K,
    value: WidgetPrefs[K],
  ) => Promise<void>;
} {
  const prefs = useSyncExternalStore(
    subscribe,
    () => state,
    () => DEFAULT_WIDGET_PREFS,
  );
  useEffect(() => {
    void ensureHydrated();
  }, []);
  const set = useCallback(
    <K extends keyof WidgetPrefs>(key: K, value: WidgetPrefs[K]) =>
      setWidgetPref(key, value),
    [],
  );
  return { prefs, hydrated, set };
}

/** 语气改写：口语化 / 简洁 / 关闭（返回空串表示不显示）。 */
export function toneLine(tone: Tone, casual: string, concise: string): string {
  if (tone === "off") return "";
  return tone === "concise" ? concise : casual;
}
