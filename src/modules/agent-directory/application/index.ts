import type { AgentDirectoryModuleContract } from "../contracts";

export type {
  AgentInstallationInspectOptions,
  AgentInstallationRepository,
  AgentInstallationSnapshot,
  InstallationPlatform,
} from "./installation-repository";

/** Internal application seam; expose a deliberate public use case only when needed. */
export interface AgentDirectoryApplication {
  readonly contract: AgentDirectoryModuleContract;
}
