export const securityMonitorModuleId = "security-monitor" as const;
export type SecurityMonitorModuleId = typeof securityMonitorModuleId;
export interface SecurityMonitorModuleContract {
  readonly module: SecurityMonitorModuleId;
  readonly schemaVersion: 1;
}
