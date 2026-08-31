import { useCallback, useEffect, useSyncExternalStore } from "react";

import {
  getPreference,
  removePreference,
  setPreference,
  type PreferenceValue,
} from "../../../lib/preferences/client.ts";
import { STORAGE_KEY_PREFIX } from "../../../lib/app-config";

/**
 * Widget configuration preferences (SQLite app_preferences independent key).
 *
 * Ported from the structure and API of the prototype `src/lib/widget-prefs.ts`:
 * `useWidgetPrefs` / `setWidgetPref` / `resetWidgetPrefs`; unlike prototype,
 * The tab of this project is Security/Usage/Today, and it does not rely on the prototype mock library.
 */

/** Menu bar icon style */
export type MenuBarStyle = "icon" | "icon-num" | "icon-dot";
/** Behavior of clicking menu bar icon */
export type MenuBarClick = "panel" | "main";
/** Floating window three Tab: Security / Usage / Today */
export type WidgetTab = "safety" | "usage" | "today";
/** The default Tab when opening a floating window; "last" means restoring the last closed tab */
export type DefaultTab = WidgetTab | "last";
/** Jarvis Tone: Colloquial / Concise / Closed (do not display copy) */
export type Tone = "casual" | "concise" | "off";
/** Carousel interval (seconds); 0 = manual switching */
export type Rotate = 5 | 10 | 30 | 0;
/** Small desktop widget content */
export type SmallContent = "orb" | "safety";
/** Medium desktop widget content */
export type MediumContent = "brief" | "today" | "waste" | "safety";
/** Widget color theme */
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

export const WIDGET_PREFS_STORAGE_KEY = `${STORAGE_KEY_PREFIX}widgetPrefs`;

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
  // Only known fields are taken to avoid dirty data pollution; unknown fields are discarded.
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

/** Reads the current in-memory preference; React hydrates it from SQLite after the subscription is established. */
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
 * Only for test use: clear the module memory state and force rehydration for the next read.
 * Make persistence hydration use cases independently verifiable.
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

/** Responsive reading of widget preferences (server-side rendering returns default values). */
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

/** Tone rewriting: colloquial / concise / closed (returning an empty string means not displaying). */
export function toneLine(tone: Tone, casual: string, concise: string): string {
  if (tone === "off") return "";
  return tone === "concise" ? concise : casual;
}
