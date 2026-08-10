/** Browser-safe contracts owned by the agent-directory feature. */
export const agentDirectoryModuleId = "agent-directory" as const;
export type AgentDirectoryModuleId = typeof agentDirectoryModuleId;

/** Stable identifier shared by directory, installation and health records. */
export type AgentId = string;

/** Public capability facts suitable for a tool card. */
export interface AgentCapabilities {
  readonly usage: "native" | "adapter" | "unsupported";
  readonly skills: "read-write" | "read" | "unsupported";
  readonly agents: "read" | "unsupported";
  readonly sessions: "resume" | "unsupported";
  readonly market: "install-target" | "unsupported";
  readonly security: "scan" | "unsupported";
}

export type AgentPlatformStatus = "supported" | "planned" | "unsupported";

/** Compatibility facts only. Paths, executables and platform bases are private. */
export interface AgentPlatformAvailability {
  readonly macos: AgentPlatformStatus;
  readonly windows10: AgentPlatformStatus;
  readonly windows11: AgentPlatformStatus;
  readonly linux: AgentPlatformStatus;
}

/**
 * An opaque cross-module reference to a pricing observation. It is optional:
 * pricing is owned by the pricing module and an Agent/tool never contains a
 * rate, model matcher, billing route or pricing rule configuration.
 */
export type PricingObservationRef = `pricing-observation:${string}`;

/** Static, browser-safe product fact projected from the tool registry. */
export interface AgentDefinition {
  readonly id: AgentId;
  readonly name: string;
  readonly nameZh: string;
  readonly icon?: string;
  readonly legacy?: boolean;
  readonly capabilities: AgentCapabilities;
  readonly platforms: AgentPlatformAvailability;
  readonly pricingObservationRef?: PricingObservationRef;
}

/** Runtime installation state. P2-02 will populate it through a server adapter. */
export interface AgentInstallation {
  readonly agentId: AgentId;
  readonly status: "installed" | "not-detected" | "unsupported" | "unknown";
  readonly observedAt?: string;
}

/** Source health summary; diagnostics remain server-side and are redacted. */
export interface AgentHealth {
  readonly agentId: AgentId;
  readonly status: "healthy" | "degraded" | "unavailable" | "unknown";
  readonly observedAt?: string;
  readonly issueCode?: `errors.${string}`;
}

/** A proposed, confirmation-gated transfer between two Agent products. */
export interface MigrationCandidate {
  readonly id: string;
  readonly sourceAgentId: AgentId;
  readonly targetAgentId: AgentId;
  readonly status: "available" | "unsupported" | "blocked";
  readonly transferable: readonly ("skills" | "agents")[];
  readonly requiresConfirmation: true;
}

export interface AgentDirectorySnapshot {
  readonly definitions: readonly AgentDefinition[];
  readonly installations: readonly AgentInstallation[];
  readonly health: readonly AgentHealth[];
  readonly migrationCandidates: readonly MigrationCandidate[];
}

export interface AgentDirectoryModuleContract {
  readonly module: AgentDirectoryModuleId;
  readonly schemaVersion: 1;
}
