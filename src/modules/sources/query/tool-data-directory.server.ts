import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import { assertToolDataRootPath } from "../../../platform/database/tool-data-root-repository.server.ts";
import { getTool } from "../../../lib/tool-registry/registry.ts";
import { osFromProcess } from "../../../lib/tools/detection.server.ts";
import { isToolDataRootConfigurable } from "../../../lib/tool-data-root/tool-data-root.server.ts";

/**
 * Sources "设置数据目录" configuration service.
 *
 * Values are the absolute directories the user picked in the native folder
 * dialog. They are persisted in `tool_data_roots` (migration 0003) and must
 * never reach browser projections, snapshots or exports — only the config
 * modal echoes the current value back to the same user.
 */

/**
 * Expand a leading `~` (the user's home) so hidden directories such as
 * `~/.hermes` can be entered by hand on macOS/Windows without fighting the
 * native folder dialog. Non-`~` values are returned unchanged.
 */
export function expandTildePath(
  value: string,
  home: string = homedir(),
): string {
  const trimmed = value.trim();
  if (trimmed === "~") return home;
  if (trimmed.startsWith("~/")) return join(home, trimmed.slice(2));
  return trimmed;
}

export interface ToolDataDirectoryView {
  readonly toolId: string;
  readonly configured: boolean;
  /** Absolute directory when configured, else null. */
  readonly dataDir: string | null;
}

function assertConfigurableTool(toolId: string): void {
  const def = getTool(toolId);
  if (def == null) {
    throw new Error("unknown-tool");
  }
  if (!isToolDataRootConfigurable(def, osFromProcess(process.platform))) {
    throw new Error("tool-not-configurable");
  }
}

export async function readToolDataDirectory(
  repository: { get(toolId: string): Promise<{ dataDir: string } | undefined> },
  toolId: string,
): Promise<string | null> {
  assertConfigurableTool(toolId);
  return (await repository.get(toolId))?.dataDir ?? null;
}

export async function writeToolDataDirectory(
  repository: {
    set(toolId: string, dataDir: string): Promise<void>;
    delete(toolId: string): Promise<boolean>;
  },
  toolId: string,
  dataDir: string | null,
): Promise<ToolDataDirectoryView> {
  assertConfigurableTool(toolId);
  if (dataDir == null) {
    await repository.delete(toolId);
    return { toolId, configured: false, dataDir: null };
  }
  const value = expandTildePath(dataDir);
  assertToolDataRootPath(toolId, value);
  if (!isAbsolute(value)) {
    throw new Error("not-absolute");
  }
  let directory = false;
  try {
    directory = (await stat(value)).isDirectory();
  } catch {
    directory = false;
  }
  if (!directory) {
    throw new Error("not-a-directory");
  }
  await repository.set(toolId, value);
  return { toolId, configured: true, dataDir: value };
}
