/** Browser-safe contracts owned by the agent-directory feature. */
export const agentDirectoryModuleId = "agent-directory" as const;
export type AgentDirectoryModuleId = typeof agentDirectoryModuleId;
export interface AgentDirectoryModuleContract {
  readonly module: AgentDirectoryModuleId;
  readonly schemaVersion: 1;
}
