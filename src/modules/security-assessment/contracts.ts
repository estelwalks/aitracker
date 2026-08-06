export const securityAssessmentModuleId = "security-assessment" as const;
export type SecurityAssessmentModuleId = typeof securityAssessmentModuleId;
export interface SecurityAssessmentModuleContract {
  readonly module: SecurityAssessmentModuleId;
  readonly schemaVersion: 1;
}
