import { constants } from "node:fs";
import { access, lstat } from "node:fs/promises";
import { delimiter, join, posix } from "node:path";

import type { AiTool } from "./catalog.ts";
import {
  getTool,
  resolvePlatformPlan,
  type PlatformOs,
} from "../tool-registry/registry.ts";

/** A filesystem fact, intentionally independent of any log parser result. */
export interface ToolInstallationFact {
  id: string;
  installed: boolean;
  /** Concrete existing probe paths. Empty when the tool was not found. */
  detectedPaths: string[];
}

function joinHomeRoot(homeDirectory: string, root: string): string {
  // Pure projection tests and macOS scanner inputs may use POSIX paths even
  // when executed on Windows. Preserve their separator semantics while real
  // Windows homes continue to use the native path implementation.
  return homeDirectory.startsWith("/")
    ? posix.join(homeDirectory, root)
    : join(homeDirectory, root);
}

/** Map node's process.platform to the registry's platform-os model. */
export function osFromProcess(platform: NodeJS.Platform): PlatformOs {
  if (platform === "darwin") return "macos";
  if (platform === "win32") return "windows";
  return "linux";
}

/**
 * Per-os probe roots from the registry platform plan (P4-T1). Tools whose
 * platform status is not "supported" (e.g. linux: planned) produce no probe
 * roots - they are never scanned (docs §6.1).
 */
export function detectRootsForOs(
  tools: readonly AiTool[],
  os: PlatformOs,
): ReadonlyMap<string, readonly string[]> {
  return new Map(
    tools.map((tool) => {
      const plan = resolvePlatformPlan(tool.id, "detection", os);
      if (!plan || plan.status !== "supported") return [tool.id, []];
      return [tool.id, plan.paths];
    }),
  );
}

/**
 * Pure projection used by tests and callers that already have probe results.
 * A tool is installed when at least one declared probe root exists.
 */
export function deriveToolInstallationFacts(
  tools: readonly AiTool[],
  existingPaths: ReadonlySet<string>,
  homeDirectory: string,
  os: PlatformOs = osFromProcess(process.platform),
  executablePathsByTool: ReadonlyMap<string, readonly string[]> = new Map(),
): ToolInstallationFact[] {
  const rootsByTool = detectRootsForOs(tools, os);
  return tools.map((tool) => {
    const detectedPaths = (rootsByTool.get(tool.id) ?? [])
      .map((root) => joinHomeRoot(homeDirectory, root))
      .filter((path) => existingPaths.has(path));
    const executablePaths = executablePathsByTool.get(tool.id) ?? [];
    const allEvidence = [...new Set([...detectedPaths, ...executablePaths])];
    return {
      id: tool.id,
      installed: allEvidence.length > 0,
      detectedPaths: allEvidence,
    };
  });
}

async function executableEvidence(
  tools: readonly AiTool[],
  os: PlatformOs,
  signal?: AbortSignal,
): Promise<ReadonlyMap<string, readonly string[]>> {
  signal?.throwIfAborted();
  const pathDirectories = (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean);
  const windowsExtensions = (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
    .split(";")
    .filter(Boolean);
  const evidence = new Map<string, string[]>();
  for (const tool of tools) {
    // P5-T5-03: stop starting new probes once the refresh is cancelled.
    signal?.throwIfAborted();
    const plan = resolvePlatformPlan(tool.id, "detection", os);
    if (plan?.status !== "supported") continue;
    const executableNames = getTool(tool.id)?.detection.executable ?? [];
    const candidates = executableNames.flatMap((name) =>
      pathDirectories.flatMap((directory) =>
        os === "windows"
          ? windowsExtensions.map((extension) =>
              join(directory, `${name}${extension.toLowerCase()}`),
            )
          : [join(directory, name)],
      ),
    );
    const existing = (
      await Promise.all(
        candidates.map(async (candidate) => {
          signal?.throwIfAborted();
          try {
            await access(
              candidate,
              os === "windows" ? constants.F_OK : constants.X_OK,
            );
            return candidate;
          } catch {
            return null;
          }
        }),
      )
    ).filter((value): value is string => value != null);
    if (existing.length > 0) evidence.set(tool.id, existing);
  }
  return evidence;
}

/** Probe all catalog roots without reading any log content. */
export async function detectToolInstallations(
  tools: readonly AiTool[],
  homeDirectory: string,
  os: PlatformOs = osFromProcess(process.platform),
  signal?: AbortSignal,
): Promise<ToolInstallationFact[]> {
  signal?.throwIfAborted();
  const rootsByTool = detectRootsForOs(tools, os);
  const candidatePaths = tools.flatMap((tool) =>
    (rootsByTool.get(tool.id) ?? []).map((root) => join(homeDirectory, root)),
  );
  const inspected = (
    await Promise.all(
      candidatePaths.map(async (path) => {
        signal?.throwIfAborted();
        try {
          await lstat(path);
          return path;
        } catch {
          return null;
        }
      }),
    )
  ).filter((path): path is string => path !== null);
  const executables = await executableEvidence(tools, os, signal);
  return deriveToolInstallationFacts(
    tools,
    new Set(inspected),
    homeDirectory,
    os,
    executables,
  );
}

/**
 * Executable-only installation probe (PATH lookups, no root checks). Used by
 * the skills install path to reject installs into tools that are not actually
 * present on the machine (e.g. a leftover `~/.cursor` directory without the
 * Cursor app / CLI installed).
 */
export async function detectToolExecutables(
  tools: readonly AiTool[],
  os: PlatformOs = osFromProcess(process.platform),
  signal?: AbortSignal,
): Promise<ReadonlyMap<string, readonly string[]>> {
  return executableEvidence(tools, os, signal);
}
