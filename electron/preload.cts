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
  type SecurityModelConfigInput,
  type SecurityModelConfigView,
  type SecurityRuntimeCapability,
  type SecurityScanHistoryEntry,
  type SecurityScanSchedule,
  type SecurityScanStartRequest,
  type SecurityScanState,
  type SecuritySkillTarget,
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
    ipcRenderer.invoke(
      desktopIpc.getLocalePreferences,
    ) as Promise<LocalePreferences>,
  setLocaleMode: (mode: DesktopPreferenceMode, locale?: DesktopLocale) =>
    ipcRenderer.invoke(desktopIpc.setLocaleMode, mode, locale) as Promise<void>,
  setCurrencyMode: (mode: DesktopPreferenceMode, currency?: DesktopCurrency) =>
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
  listSecuritySkills: () =>
    ipcRenderer.invoke(desktopIpc.listSecuritySkills) as Promise<
      SecuritySkillTarget[]
    >,
  selectSecuritySkillDirectory: () =>
    ipcRenderer.invoke(
      desktopIpc.selectSecuritySkillDirectory,
    ) as Promise<SecuritySkillTarget | null>,
  startSecurityScan: (request: SecurityScanStartRequest) =>
    ipcRenderer.invoke(
      desktopIpc.startSecurityScan,
      request,
    ) as Promise<SecurityScanState>,
  getSecurityScanStatus: () =>
    ipcRenderer.invoke(
      desktopIpc.getSecurityScanStatus,
    ) as Promise<SecurityScanState>,
  getSecurityScanHistory: () =>
    ipcRenderer.invoke(desktopIpc.getSecurityScanHistory) as Promise<
      SecurityScanHistoryEntry[]
    >,
  cancelSecurityScan: () =>
    ipcRenderer.invoke(desktopIpc.cancelSecurityScan) as Promise<{
      cancelled: boolean;
    }>,
  getSecurityModelConfig: () =>
    ipcRenderer.invoke(
      desktopIpc.getSecurityModelConfig,
    ) as Promise<SecurityModelConfigView>,
  setSecurityModelConfig: (config: SecurityModelConfigInput) =>
    ipcRenderer.invoke(
      desktopIpc.setSecurityModelConfig,
      config,
    ) as Promise<SecurityModelConfigView>,
  getSecurityScanSchedule: () =>
    ipcRenderer.invoke(
      desktopIpc.getSecurityScanSchedule,
    ) as Promise<SecurityScanSchedule>,
  setSecurityScanSchedule: (schedule: SecurityScanSchedule) =>
    ipcRenderer.invoke(
      desktopIpc.setSecurityScanSchedule,
      schedule,
    ) as Promise<SecurityScanSchedule>,
  getSecurityRuntimeCapability: () =>
    ipcRenderer.invoke(
      desktopIpc.getSecurityRuntimeCapability,
    ) as Promise<SecurityRuntimeCapability>,
});

contextBridge.exposeInMainWorld(DESKTOP_GLOBAL, desktopApi);
// Renderer modules use this established contract. Keep the configured name
// above as a compatibility alias for existing integrations.
contextBridge.exposeInMainWorld("desktopApi", desktopApi);
