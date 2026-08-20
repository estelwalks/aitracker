import { lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, posix } from "node:path";

import {
  getDefaultRegistry,
  resolvePlatformPlan,
  type CompiledRegistry,
  type PlatformOs,
} from "../../../lib/tool-registry/registry.ts";
import type { ToolDefinition } from "../../../lib/tool-registry/contracts.ts";
import { type AgentHealth, type AgentInstallation } from "../contracts.ts";
import {
  type AgentInstallationInspectOptions,
  type AgentInstallationRepository,
  type AgentInstallationSnapshot,
  type InstallationPlatform,
} from "../application/installation-repository.ts";

export interface InstallationProbeFileSystem {
  probe(path: string, signal?: AbortSignal): Promise<ProbeOutcome>;
}

export type ProbeOutcome = "present" | "missing" | "inaccessible";

function joinHomeRoot(home: string, root: string): string {
  return home.startsWith("/") ? posix.join(home, root) : join(home, root);
}

/** Internal error with a stable code; its message never contains a path. */
export class AgentInstallationRepositoryError extends Error {
  readonly name = "AgentInstallationRepositoryError";

  constructor(readonly code: "cancelled" | "probe-failed") {
    super(`agent-installation:${code}`);
  }
}

function platformOs(platform: InstallationPlatform): PlatformOs {
  return platform === "macos"
    ? "macos"
    : platform === "linux"
      ? "linux"
      : "windows";
}

function processPlatform(): InstallationPlatform {
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "windows11";
  return "linux";
}

function nowIso(): string {
  return new Date().toISOString();
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new AgentInstallationRepositoryError("cancelled");
  }
}

function publicStatus(
  planStatus: "supported" | "planned" | "unsupported",
  outcome: ProbeOutcome | undefined,
): AgentInstallation["status"] {
  if (planStatus !== "supported") return "unsupported";
  if (outcome === "present") return "installed";
  if (outcome === "inaccessible") return "unknown";
  return "not-detected";
}

function publicHealth(
  planStatus: "supported" | "planned" | "unsupported",
  outcome: ProbeOutcome | undefined,
): Pick<AgentHealth, "status" | "issueCode"> {
  if (planStatus === "planned") {
    return { status: "unavailable", issueCode: "errors.platform-planned" };
  }
  if (planStatus === "unsupported") {
    return { status: "unavailable", issueCode: "errors.platform-unsupported" };
  }
  if (outcome === "inaccessible") {
    return {
      status: "degraded",
      issueCode: "errors.installation-access-denied",
    };
  }
  return outcome === "present" ? { status: "healthy" } : { status: "unknown" };
}

/** Node-only filesystem adapter. Absolute paths remain inside infrastructure. */
export function createNodeInstallationProbe(): InstallationProbeFileSystem {
  return {
    async probe(path, signal) {
      throwIfAborted(signal);
      try {
        await lstat(path);
        throwIfAborted(signal);
        return "present";
      } catch (error) {
        if (error instanceof AgentInstallationRepositoryError) throw error;
        const code =
          typeof error === "object" && error !== null && "code" in error
            ? (error as { code?: unknown }).code
            : undefined;
        if (code === "ENOENT" || code === "ENOTDIR") return "missing";
        if (code === "EACCES" || code === "EPERM") return "inaccessible";
        throw new AgentInstallationRepositoryError("probe-failed");
      }
    },
  };
}

export interface CreateAgentInstallationRepositoryOptions {
  readonly registry?: CompiledRegistry;
  readonly fileSystem?: InstallationProbeFileSystem;
  readonly homeDirectory?: string;
  readonly clock?: () => string;
}

/**
 * Installation repository backed by the compiled tool registry. It performs
 * only lstat probes; it does not read logs, execute tools, or expose paths.
 */
export function createAgentInstallationRepository(
  options: CreateAgentInstallationRepositoryOptions = {},
): AgentInstallationRepository {
  const registry = options.registry ?? getDefaultRegistry();
  const fileSystem = options.fileSystem ?? createNodeInstallationProbe();
  const defaultHome = options.homeDirectory ?? homedir();
  const clock = options.clock ?? nowIso;

  return {
    async inspect(input: AgentInstallationInspectOptions = {}) {
      const home = input.homeDirectory ?? defaultHome;
      const target = input.platform ?? processPlatform();
      const os = platformOs(target);
      const observedAt = clock();
      const installations: AgentInstallation[] = [];
      const health: AgentHealth[] = [];

      for (const definition of registry.definitions.filter(
        (item) => item.catalogVisible !== false,
      )) {
        throwIfAborted(input.signal);
        const plan = resolvePlatformPlan(
          definition.id,
          "detection",
          os,
          registry,
        );
        const status = plan?.status ?? "unsupported";
        let outcome: ProbeOutcome | undefined;

        if (status === "supported" && plan) {
          for (const root of plan.paths) {
            throwIfAborted(input.signal);
            const next = await fileSystem.probe(
              joinHomeRoot(home, root),
              input.signal,
            );
            if (next === "present" || next === "inaccessible") {
              outcome = next;
              if (next === "present") break;
            }
          }
        }

        installations.push({
          agentId: definition.id,
          status: publicStatus(status, outcome),
          observedAt,
        });
        const healthView = publicHealth(status, outcome);
        health.push({
          agentId: definition.id,
          status: healthView.status,
          observedAt,
          ...(healthView.issueCode ? { issueCode: healthView.issueCode } : {}),
        });
      }

      return { installations, health } satisfies AgentInstallationSnapshot;
    },
  };
}

/** Useful for tests and composition roots that need an explicit definition list. */
export function installationDefinitions(
  registry: CompiledRegistry = getDefaultRegistry(),
): readonly ToolDefinition[] {
  return registry.definitions.filter((item) => item.catalogVisible !== false);
}
