export const settingsModuleId = "settings" as const;
export type SettingsModuleId = typeof settingsModuleId;
export interface SettingsModuleContract {
  readonly module: SettingsModuleId;
  readonly schemaVersion: 1;
}
