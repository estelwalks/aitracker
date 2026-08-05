import { contextBridge, ipcRenderer } from "electron";

import {
  desktopIpc,
  type AutoLaunchState,
  type DesktopCurrency,
  type DesktopLocale,
  type DesktopPreferenceMode,
  type DesktopApi,
  type LocalePreferences,
  type RuntimeInfo,
} from "./contracts.js";
import { DESKTOP_GLOBAL } from "./app-config.js";

const desktopApi: DesktopApi = Object.freeze({
  getRuntimeInfo: () =>
    ipcRenderer.invoke(desktopIpc.getRuntimeInfo) as Promise<RuntimeInfo>,
  getAutoLaunch: () =>
    ipcRenderer.invoke(desktopIpc.getAutoLaunch) as Promise<AutoLaunchState>,
  setAutoLaunch: (enabled: boolean) =>
    ipcRenderer.invoke(
      desktopIpc.setAutoLaunch,
      enabled,
    ) as Promise<AutoLaunchState>,
  showWindow: () => ipcRenderer.invoke(desktopIpc.showWindow) as Promise<void>,
  getPreferences: () =>
    ipcRenderer.invoke(desktopIpc.getPreferences) as Promise<
      Record<string, unknown>
    >,
  setPreference: (key: string, value: unknown) =>
    ipcRenderer.invoke(desktopIpc.setPreference, key, value) as Promise<void>,
  resetPreferences: () =>
    ipcRenderer.invoke(desktopIpc.resetPreferences) as Promise<{
      removedKeys: number;
    }>,
  getLocale: () =>
    ipcRenderer.invoke(desktopIpc.getLocale) as Promise<DesktopLocale>,
  setLocale: (locale: DesktopLocale) =>
    ipcRenderer.invoke(desktopIpc.setLocale, locale) as Promise<void>,
  onLocaleChanged: (callback: (locale: DesktopLocale) => void) => {
    const listener = (_event: unknown, locale: unknown) => {
      callback(locale as DesktopLocale);
    };
    ipcRenderer.on(desktopIpc.localeChanged, listener);
    return () => {
      ipcRenderer.removeListener(desktopIpc.localeChanged, listener);
    };
  },
  getLocalePreferences: () =>
    ipcRenderer.invoke(desktopIpc.getLocalePreferences) as Promise<
      LocalePreferences
    >,
  setLocaleMode: (mode: DesktopPreferenceMode, locale?: DesktopLocale) =>
    ipcRenderer.invoke(
      desktopIpc.setLocaleMode,
      mode,
      locale,
    ) as Promise<void>,
  setCurrencyMode: (
    mode: DesktopPreferenceMode,
    currency?: DesktopCurrency,
  ) =>
    ipcRenderer.invoke(
      desktopIpc.setCurrencyMode,
      mode,
      currency,
    ) as Promise<void>,
  onPreferencesChanged: (callback: (prefs: LocalePreferences) => void) => {
    const listener = (_event: unknown, prefs: unknown) => {
      callback(prefs as LocalePreferences);
    };
    ipcRenderer.on(desktopIpc.preferencesChanged, listener);
    return () => {
      ipcRenderer.removeListener(desktopIpc.preferencesChanged, listener);
    };
  },
});

contextBridge.exposeInMainWorld(DESKTOP_GLOBAL, desktopApi);
