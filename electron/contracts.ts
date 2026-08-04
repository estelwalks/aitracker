export const desktopIpc = {
  getRuntimeInfo: "desktop:get-runtime-info",
  getAutoLaunch: "desktop:get-auto-launch",
  setAutoLaunch: "desktop:set-auto-launch",
  showWindow: "desktop:show-window",
  getPreferences: "desktop:get-preferences",
  setPreference: "desktop:set-preference",
  resetPreferences: "desktop:reset-preferences",
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
  getPreferences(): Promise<Record<string, unknown>>;
  setPreference(key: string, value: unknown): Promise<void>;
  resetPreferences(): Promise<{ removedKeys: number }>;
}
