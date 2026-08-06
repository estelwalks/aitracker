export const distillationModuleId = "distillation" as const;
export type DistillationModuleId = typeof distillationModuleId;
export interface DistillationModuleContract {
  readonly module: DistillationModuleId;
  readonly schemaVersion: 1;
}
