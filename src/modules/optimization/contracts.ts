export const optimizationModuleId = "optimization" as const;
export type OptimizationModuleId = typeof optimizationModuleId;
export interface OptimizationModuleContract {
  readonly module: OptimizationModuleId;
  readonly schemaVersion: 1;
}
