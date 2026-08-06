import type { AgentDirectoryModuleContract } from "../contracts";

/** Internal application seam; expose a deliberate public use case only when needed. */
export interface AgentDirectoryApplication {
  readonly contract: AgentDirectoryModuleContract;
}
