import type { AgentHealth, AgentInstallation } from "../contracts.ts";

/** Supported installation targets. Windows 10 and 11 intentionally share the
 * same resolver group until a target-specific probe is declared. */
export type InstallationPlatform =
  "macos" | "windows10" | "windows11" | "linux";

export interface AgentInstallationSnapshot {
  readonly installations: readonly AgentInstallation[];
  readonly health: readonly AgentHealth[];
}

export interface AgentInstallationInspectOptions {
  readonly homeDirectory?: string;
  readonly platform?: InstallationPlatform;
  readonly signal?: AbortSignal;
}

/** Application port. Implementations must never expose probe paths or errors. */
export interface AgentInstallationRepository {
  inspect(
    options?: AgentInstallationInspectOptions,
  ): Promise<AgentInstallationSnapshot>;
}
