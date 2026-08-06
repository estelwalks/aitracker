export const skillDistributionModuleId = "skill-distribution" as const;
export type SkillDistributionModuleId = typeof skillDistributionModuleId;
export interface SkillDistributionModuleContract {
  readonly module: SkillDistributionModuleId;
  readonly schemaVersion: 1;
}
