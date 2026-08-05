export const desktopIpc = {
  getRuntimeInfo: "desktop:get-runtime-info",
  getAutoLaunch: "desktop:get-auto-launch",
  setAutoLaunch: "desktop:set-auto-launch",
  showWindow: "desktop:show-window",
  getPreferences: "desktop:get-preferences",
  setPreference: "desktop:set-preference",
  resetPreferences: "desktop:reset-preferences",
  getLocale: "desktop:get-locale",
  setLocale: "desktop:set-locale",
  localeChanged: "desktop:locale-changed",
  getLocalePreferences: "desktop:get-locale-preferences",
  setLocaleMode: "desktop:set-locale-mode",
  setCurrencyMode: "desktop:set-currency-mode",
  preferencesChanged: "desktop:preferences-changed",
} as const;

/**
 * The four locales supported by the desktop shell. MUST stay in sync with
 * `src/lib/i18n/locale.ts` — `scripts/check-locale-sync.mjs` guards this,
 * because the Electron tsconfig boundary prevents a safe cross-import.
 */
export type DesktopLocale = "zh-CN" | "en-US" | "ja-JP" | "ko-KR";

/**
 * Display currencies (docs/plan v1.2). MUST stay in sync with
 * `src/lib/i18n/locale.ts` (CURRENCIES) — guarded by check-locale-sync.mjs.
 */
export type DesktopCurrency = "CNY" | "USD" | "JPY" | "KRW";

/** Each preference follows the system or is pinned manually (v1.2). */
export type DesktopPreferenceMode = "system" | "manual";

/** Where a resolved value came from — surfaced in the settings page. */
export type DesktopPreferenceSource = "system" | "manual" | "fallback";

/** Full resolved display preferences (single source of truth in main). */
export interface LocalePreferences {
  locale: DesktopLocale;
  localeSource: DesktopPreferenceSource;
  displayCurrency: DesktopCurrency;
  currencySource: DesktopPreferenceSource;
}

export interface RuntimeInfo {
  platform: NodeJS.Platform;
  version: string;
  packaged: boolean;
}

export interface AutoLaunchState {
  enabled: boolean;
  supported: boolean;
}

export interface AITrackerDesktopApi {
  getRuntimeInfo(): Promise<RuntimeInfo>;
  getAutoLaunch(): Promise<AutoLaunchState>;
  setAutoLaunch(enabled: boolean): Promise<AutoLaunchState>;
  showWindow(): Promise<void>;
  getPreferences(): Promise<Record<string, unknown>>;
  setPreference(key: string, value: unknown): Promise<void>;
  resetPreferences(): Promise<{ removedKeys: number }>;
  /** Resolve the current display locale (user preference > system > zh-CN). */
  getLocale(): Promise<DesktopLocale>;
  /**
   * Persist a locale choice to `trusttools-prefs.json` and rebuild the native
   * tray/menus. Rejects non-locale values; the renderer must only send one of
   * the four `DesktopLocale` strings.
   */
  setLocale(locale: DesktopLocale): Promise<void>;
  /** Subscribe to locale changes initiated in the main process; returns an unsubscribe function. */
  onLocaleChanged(callback: (locale: DesktopLocale) => void): () => void;
  /** Resolve locale + display currency (manual preference > system > fallback). */
  getLocalePreferences(): Promise<LocalePreferences>;
  /**
   * Set the language preference: "system" follows the OS; "manual" pins a
   * locale (required in manual mode). Persisted to prefs; tray/menus rebuild.
   */
  setLocaleMode(
    mode: DesktopPreferenceMode,
    locale?: DesktopLocale,
  ): Promise<void>;
  /**
   * Set the display-currency preference, independent of the language:
   * "system" maps the OS locale's region; "manual" pins a currency (required
   * in manual mode).
   */
  setCurrencyMode(
    mode: DesktopPreferenceMode,
    currency?: DesktopCurrency,
  ): Promise<void>;
  /** Subscribe to preference changes; returns an unsubscribe function. */
  onPreferencesChanged(
    callback: (prefs: LocalePreferences) => void,
  ): () => void;
}
