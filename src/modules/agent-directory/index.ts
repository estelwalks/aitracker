/** Browser-safe public entry. Server adapters and infrastructure stay private. */
export { agentDirectoryModuleId } from "./contracts";
export type {
  AgentCapabilities,
  AgentDefinition,
  AgentDirectoryModuleContract,
  AgentDirectoryModuleId,
  AgentDirectorySnapshot,
  AgentHealth,
  AgentId,
  AgentInstallation,
  AgentPlatformAvailability,
  AgentPlatformStatus,
  MigrationCandidate,
  PricingObservationRef,
} from "./contracts";
export { projectAgentDefinitions } from "./registry-projection";
export type { AgentDirectoryViewModel } from "./presentation";

// Server composition roots import this explicit adapter path. It is not
// re-exported from the browser-safe module entry.
