export const searchModuleId = "search" as const;
export type SearchModuleId = typeof searchModuleId;
export interface SearchModuleContract {
  readonly module: SearchModuleId;
  readonly schemaVersion: 1;
}
