import { contextBridge, ipcRenderer } from "electron";

import type {
  AutoLaunchState,
  RuntimeInfo,
  TrustToolsDesktopApi,
} from "./contracts.js";

const desktopIpc = {
  getRuntimeInfo: "desktop:get-runtime-info",
  getAutoLaunch: "desktop:get-auto-launch",
  setAutoLaunch: "desktop:set-auto-launch",
  showWindow: "desktop:show-window",
} as const;

const desktopApi: TrustToolsDesktopApi = Object.freeze({
  getRuntimeInfo: () =>
    ipcRenderer.invoke(desktopIpc.getRuntimeInfo) as Promise<RuntimeInfo>,
  getAutoLaunch: () =>
    ipcRenderer.invoke(desktopIpc.getAutoLaunch) as Promise<AutoLaunchState>,
  setAutoLaunch: (enabled: boolean) =>
    ipcRenderer.invoke(
      desktopIpc.setAutoLaunch,
      enabled,
    ) as Promise<AutoLaunchState>,
  showWindow: () =>
    ipcRenderer.invoke(desktopIpc.showWindow) as Promise<void>,
});

contextBridge.exposeInMainWorld("trustToolsDesktop", desktopApi);
