import { lstat } from "node:fs/promises";
import { join } from "node:path";

import type { AiTool } from "./catalog.ts";

/** A filesystem fact, intentionally independent of any log parser result. */
export interface ToolInstallationFact {
  id: string;
  installed: boolean;
  /** Concrete existing probe paths. Empty when the tool was not found. */
  detectedPaths: string[];
}

/**
 * Pure projection used by tests and callers that already have probe results.
 * A tool is installed when at least one declared probe root exists.
 */
export function deriveToolInstallationFacts(
  tools: readonly AiTool[],
  existingPaths: ReadonlySet<string>,
  homeDirectory: string,
): ToolInstallationFact[] {
  return tools.map((tool) => {
    const detectedPaths = tool.detectRoots
      .map((root) => join(homeDirectory, root))
      .filter((path) => existingPaths.has(path));
    return { id: tool.id, installed: detectedPaths.length > 0, detectedPaths };
  });
}

/** Probe all catalog roots without reading any log content. */
export async function detectToolInstallations(
  tools: readonly AiTool[],
  homeDirectory: string,
): Promise<ToolInstallationFact[]> {
  const candidatePaths = tools.flatMap((tool) =>
    tool.detectRoots.map((root) => join(homeDirectory, root)),
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
  );
}
