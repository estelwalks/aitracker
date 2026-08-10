export const sharedUiModuleId = "shared-ui" as const;
export type SharedUiModuleId = typeof sharedUiModuleId;
export interface SharedUiModuleContract {
  readonly module: SharedUiModuleId;
  readonly schemaVersion: 1;
}
