import { useCallback, useSyncExternalStore } from "react";

/**
 * 小组件配置偏好（localStorage 独立 key，避免改动 prefs 契约）。
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

function storage(): Storage | null {
  if (typeof globalThis === "undefined") return null;
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    // localStorage 不可用（隐私模式/测试环境）——偏好为尽力而为
    return null;
  }
}

let state: WidgetPrefs = DEFAULT_WIDGET_PREFS;
let hydrated = false;
const listeners = new Set<() => void>();

function readStored(): WidgetPrefs {
  const ls = storage();
  if (ls == null) return DEFAULT_WIDGET_PREFS;
  try {
    const raw = ls.getItem(WIDGET_PREFS_STORAGE_KEY);
    if (raw == null || raw === "") return DEFAULT_WIDGET_PREFS;
    const parsed = JSON.parse(raw) as Partial<WidgetPrefs>;
    // 只取已知字段，避免脏数据污染；未知字段被丢弃。
    return {
      ...DEFAULT_WIDGET_PREFS,
      ...(typeof parsed.barStyle === "string"
        ? { barStyle: parsed.barStyle }
        : {}),
      ...(typeof parsed.barClick === "string"
        ? { barClick: parsed.barClick }
        : {}),
      ...(typeof parsed.defaultTab === "string"
        ? { defaultTab: parsed.defaultTab }
        : {}),
      ...(typeof parsed.lastTab === "string"
        ? { lastTab: parsed.lastTab }
        : {}),
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
  } catch {
    return DEFAULT_WIDGET_PREFS;
  }
}

function ensureHydrated(): void {
  if (hydrated) return;
  hydrated = true;
  state = readStored();
}

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  ensureHydrated();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 读取当前内存中的偏好（首次访问时从 localStorage 水合）。 */
export function readWidgetPrefs(): WidgetPrefs {
  ensureHydrated();
  return state;
}

export function setWidgetPref<K extends keyof WidgetPrefs>(
  key: K,
  value: WidgetPrefs[K],
): void {
  ensureHydrated();
  state = { ...state, [key]: value };
  const ls = storage();
  if (ls != null) {
    try {
      ls.setItem(WIDGET_PREFS_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore
    }
  }
  emit();
}

export function resetWidgetPrefs(): void {
  state = DEFAULT_WIDGET_PREFS;
  const ls = storage();
  if (ls != null) {
    try {
      ls.removeItem(WIDGET_PREFS_STORAGE_KEY);
    } catch {
      // ignore
    }
  }
  emit();
}

/**
 * 仅测试使用：清空模块内存态并强制下次读取重新水合，
 * 使「写入 localStorage 后重新读取」的用例可独立验证。
 */
export function __resetWidgetPrefsModuleForTest(): void {
  state = DEFAULT_WIDGET_PREFS;
  hydrated = false;
  listeners.clear();
}

/** 响应式读取小组件偏好（服务端渲染返回默认值）。 */
export function useWidgetPrefs(): {
  prefs: WidgetPrefs;
  set: <K extends keyof WidgetPrefs>(key: K, value: WidgetPrefs[K]) => void;
} {
  const prefs = useSyncExternalStore(
    subscribe,
    () => state,
    () => DEFAULT_WIDGET_PREFS,
  );
  const set = useCallback(
    <K extends keyof WidgetPrefs>(key: K, value: WidgetPrefs[K]) =>
      setWidgetPref(key, value),
    [],
  );
  return { prefs, set };
}

/** 语气改写：口语化 / 简洁 / 关闭（返回空串表示不显示）。 */
export function toneLine(tone: Tone, casual: string, concise: string): string {
  if (tone === "off") return "";
  return tone === "concise" ? concise : casual;
}
