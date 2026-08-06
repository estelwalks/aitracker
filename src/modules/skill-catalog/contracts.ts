export const skillCatalogModuleId = "skill-catalog" as const;
export type SkillCatalogModuleId = typeof skillCatalogModuleId;
export interface SkillCatalogModuleContract {
  readonly module: SkillCatalogModuleId;
  readonly schemaVersion: 1;
}
