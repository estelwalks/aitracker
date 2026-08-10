import { lstat } from "node:fs/promises";
import { join } from "node:path";

import type { AiTool } from "./catalog.ts";
import {
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
): ToolInstallationFact[] {
  const rootsByTool = detectRootsForOs(tools, os);
  return tools.map((tool) => {
    const detectedPaths = (rootsByTool.get(tool.id) ?? [])
      .map((root) => join(homeDirectory, root))
      .filter((path) => existingPaths.has(path));
    return { id: tool.id, installed: detectedPaths.length > 0, detectedPaths };
  });
}

/** Probe all catalog roots without reading any log content. */
export async function detectToolInstallations(
  tools: readonly AiTool[],
  homeDirectory: string,
  os: PlatformOs = osFromProcess(process.platform),
): Promise<ToolInstallationFact[]> {
  const rootsByTool = detectRootsForOs(tools, os);
  const candidatePaths = tools.flatMap((tool) =>
    (rootsByTool.get(tool.id) ?? []).map((root) => join(homeDirectory, root)),
  );
  const inspected = await Promise.all(
    candidatePaths.map(async (path) => {
      try {
        await lstat(path);
        return path;
      } catch {
        return null;
      }
    }),
  );
  return deriveToolInstallationFacts(
    tools,
    new Set(inspected.filter((path): path is string => path !== null)),
    homeDirectory,
    os,
  );
}
