import { contextBridge, ipcRenderer } from "electron";

import type {
  AutoLaunchState,
  RuntimeInfo,
  AITrackerDesktopApi,
} from "./contracts.js";

const desktopIpc = {
  getRuntimeInfo: "desktop:get-runtime-info",
  getAutoLaunch: "desktop:get-auto-launch",
  setAutoLaunch: "desktop:set-auto-launch",
  showWindow: "desktop:show-window",
  getPreferences: "desktop:get-preferences",
  setPreference: "desktop:set-preference",
} as const;

const desktopApi: AITrackerDesktopApi = Object.freeze({
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
    ipcRenderer.invoke(
      desktopIpc.setPreference,
      key,
      value,
    ) as Promise<void>,
});

contextBridge.exposeInMainWorld("desktopBridge", desktopApi);
