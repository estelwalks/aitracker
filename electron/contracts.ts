export const desktopIpc = {
  getRuntimeInfo: "desktop:get-runtime-info",
  getAutoLaunch: "desktop:get-auto-launch",
  setAutoLaunch: "desktop:set-auto-launch",
  showWindow: "desktop:show-window",
} as const;

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
}
