import { isAbsolute } from "node:path";

/**
 * True for POSIX absolute paths and Windows drive-letter paths. Mirrors the
 * repository rule so the env seam accepts the same shapes on every host.
 */
function isAbsoluteOverridePath(value: string): boolean {
  if (isAbsolute(value)) return true;
  return /^[A-Za-z]:[\\/]/.test(value);
}

import type {
  PlatformTarget,
  ToolDefinition,
} from "../tool-registry/contracts.ts";
import { isHomeFlattenedRoot, uniformDataSegment } from "./placement.server.ts";

/**
 * Server-side per-tool data-directory overrides (Sources page).
 *
 * Persistence lives in the `tool_data_roots` table (migration 0003); the
 * value is an absolute directory the user picked through a native folder
 * dialog. `AITRACKER_TOOL_DATA_DIRS` (comma-separated `toolId=/abs/path`
 * pairs) is the environment/test seam and always wins over the database so
 * e2e runs stay deterministic.
 *
 * Privacy discipline: these directories are local scanning inputs. They must
 * never appear in browser projections, snapshots, exports or insights; only
 * the configuration modal may echo them back to the same user.
 */

export interface ToolDataRootRecordLike {
  readonly toolId: string;
  readonly dataDir: string;
}

export interface ToolDataRootsRepositoryLike {
  list(): Promise<readonly ToolDataRootRecordLike[]>;
}

export const TOOL_DATA_ROOTS_ENV = "AITRACKER_TOOL_DATA_DIRS";

function validPair(value: string): { toolId: string; dir: string } | null {
  const separator = value.indexOf("=");
  if (separator <= 0) return null;
  const toolId = value.slice(0, separator).trim();
  const dir = value.slice(separator + 1).trim();
  if (!/^[a-z][a-z0-9-]*$/.test(toolId)) return null;
  if (!isAbsoluteOverridePath(dir)) return null;
  return { toolId, dir };
}

/** Parse the env/test seam: "hermes=/a/b,claude-code=/c/d". */
export function parseToolDataRootsEnv(
  raw: string | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  if (raw == null) return map;
  for (const part of raw.split(",")) {
    if (part.trim() === "") continue;
    const pair = validPair(part);
    if (pair == null) continue;
    map.set(pair.toolId, pair.dir);
  }
  return map;
}

/**
 * Effective override map: persisted choices first, environment seam entries
 * last (env wins, mirroring AITRACKER_USAGE_HOME test precedence).
 */
export async function loadEffectiveToolDataRoots(
  repository: ToolDataRootsRepositoryLike | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (repository != null) {
    for (const record of await repository.list()) {
      const dir = record.dataDir.trim();
      if (dir && isAbsoluteOverridePath(dir)) map.set(record.toolId, dir);
    }
  }
  for (const [toolId, dir] of parseToolDataRootsEnv(env[TOOL_DATA_ROOTS_ENV])) {
    map.set(toolId, dir);
  }
  return map;
}

/**
 * Composition-registered provider of the persisted per-tool override map.
 * The local-skills scanner (discovery, sync, install, migration) and other
 * server entry points read the same map through this registration instead of
 * each importing the composition root (which would be a module cycle). The
 * composition root registers a provider backed by `tool_data_roots` + env.
 */
export type ToolDataRootsProvider = () =>
  ReadonlyMap<string, string> | Promise<ReadonlyMap<string, string>>;

let registeredProvider: ToolDataRootsProvider | null = null;

/** Register the process-wide provider (composition root, server startup). */
export function setToolDataRootsProvider(
  provider: ToolDataRootsProvider | null,
): void {
  registeredProvider = provider;
}

/** Test seam: clear the registered provider between tests. */
export function __resetToolDataRootsProviderForTests(): void {
  registeredProvider = null;
}

/** The current override map from the registered provider (empty by default). */
export async function registeredToolDataRoots(): Promise<
  ReadonlyMap<string, string>
> {
  if (registeredProvider == null) return new Map();
  try {
    const map = await registeredProvider();
    return map ?? new Map();
  } catch {
    // The provider may outlive its composition root in tests (or during a
    // root rebuild); fall back to defaults rather than failing the scan.
    return new Map();
  }
}

/**
 * The uniform HOME-anchored data segment of a tool definition, considering
 * usage roots, HOME-based detection locations and HOME-based skill roots.
 * Null when the tool has no rebasable data home (then the per-tool override
 * UI stays disabled).
 */
export function dataSegmentForTool(def: ToolDefinition): string | null {
  const roots: string[] = [];
  const usage = def.capabilities.usage;
  if (usage.mode !== "unsupported") {
    for (const path of usage.paths ?? []) roots.push(path.root);
  }
  for (const location of def.detection.locations ?? []) {
    if (location.base === "home") roots.push(location.path);
  }
  for (const spec of def.storage?.skills?.rootSpecs ?? []) {
    if (spec.base === "home") roots.push(spec.path);
  }
  return uniformDataSegment(roots.filter(isHomeFlattenedRoot));
}

/**
 * Whether the Sources page may offer a data-directory override for a tool:
 * it must have a rebasable data home AND something to rebase (usage logs or
 * HOME-anchored detection roots) for the given operating system.
 */
export function isToolDataRootConfigurable(
  def: ToolDefinition,
  os: "macos" | "windows" | "linux",
): boolean {
  if (dataSegmentForTool(def) == null) return false;
  const targets: readonly PlatformTarget[] =
    os === "macos"
      ? ["macos"]
      : os === "windows"
        ? ["windows10", "windows11"]
        : ["linux"];
  const usage = def.capabilities.usage;
  const usageHasRoot = usage.paths?.some(
    (path) =>
      path.targets == null ||
      path.targets.some((target) => targets.includes(target)),
  );
  const detectionHasHomeRoot = (def.detection.locations ?? []).some(
    (location) =>
      location.base === "home" &&
      location.targets.some((target) => targets.includes(target)),
  );
  return Boolean(usageHasRoot || detectionHasHomeRoot);
}
