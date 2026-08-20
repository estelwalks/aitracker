import { access, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";

import {
  findNearestGitRepositoryRoot,
  isGitRepositoryRoot,
} from "../../lib/git-repository.server.ts";
import type { DashboardProjectKind } from "./contracts.ts";

/**
 * A project label is decided on the server from local workspace evidence.
 * Browser DTOs receive only this label and kind, never a cwd or marker path.
 * The `DashboardProjectKind` type itself lives in browser-safe contracts.ts.
 */

export type { DashboardProjectKind } from "./contracts.ts";

export interface DashboardProjectClassification {
  readonly kind: DashboardProjectKind;
  /** Display-safe label; it is never a filesystem path. */
  readonly label: string;
}

export interface ProjectClassificationOptions {
  readonly home?: string;
  /**
   * Path semantics to classify under. Defaults to the running platform;
   * injectable so the Windows drive-letter behavior is verifiable on any
   * host (the disk probes themselves always run on the real filesystem).
   */
  readonly platform?: NodeJS.Platform;
}

/** Path implementation used for one classification run. */
export type ProjectPathImpl = typeof win32;

export function pathImplForPlatform(
  platform: NodeJS.Platform,
): ProjectPathImpl {
  return platform === "win32" ? win32 : posix;
}

const workspaceMarkers = [
  ".git",
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "composer.json",
  "Gemfile",
] as const;

/**
 * Turn a project reference into a concrete directory path (or null when it is
 * not a recognizable absolute path). `~/` prefixes and "~" resolve against the
 * home directory; POSIX absolute paths pass through unchanged. Drive-letter
 * absolute paths (C:/…, C:\… — backslashes are normalized above) are accepted
 * ONLY under win32 semantics: on POSIX "D:/…" can be a legal relative path and
 * must not be treated as absolute.
 */
export function normaliseProjectRefFor(
  pathImpl: ProjectPathImpl,
  project: string,
  home: string,
): string | null {
  const value = project.trim().replaceAll("\\", "/").replace(/\/+$/u, "");
  if (!value || value === "unknown") return null;
  if (value === "~") return home;
  if (value.startsWith("~/")) return pathImpl.join(home, value.slice(2));
  const windowsAbsolute = /^[A-Za-z]:\//u.test(value);
  if ((pathImpl === win32 && windowsAbsolute) || value.startsWith("/")) {
    return pathImpl.normalize(value);
  }
  return null;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function hasMarker(
  pathImpl: ProjectPathImpl,
  directory: string,
  marker: string,
): Promise<boolean> {
  try {
    await access(pathImpl.join(directory, marker));
    return true;
  } catch {
    return false;
  }
}

/**
 * Bounded probe of the workspace markers inside a directory tree. Many real
 * work directories (for example a Codex cwd holding several sub-projects)
 * have no marker at their own top level, only deeper. Without this probe they
 * would be mislabeled "quick-conversation" and disappear from the project
 * overview. The walk skips hidden directories and node_modules and stops at a
 * hard entry budget so a huge tree can never stall classification.
 */
const MAX_MARKER_PROBE_DEPTH = 5;
const MAX_MARKER_PROBE_ENTRIES = 500;

async function hasWorkspaceMarkerInSubtree(
  pathImpl: ProjectPathImpl,
  root: string,
): Promise<boolean> {
  const pending: Array<{ directory: string; depth: number }> = [
    { directory: root, depth: 0 },
  ];
  let visited = 0;
  while (pending.length > 0 && visited < MAX_MARKER_PROBE_ENTRIES) {
    const { directory, depth } = pending.pop()!;
    visited += 1;
    if (
      (await isGitRepositoryRoot(pathImpl, directory)) ||
      (
        await Promise.all(
          workspaceMarkers
            .slice(1)
            .map((marker) => hasMarker(pathImpl, directory, marker)),
        )
      ).some(Boolean)
    ) {
      return true;
    }
    if (depth >= MAX_MARKER_PROBE_DEPTH) continue;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        entry.name !== "node_modules"
      ) {
        pending.push({
          directory: pathImpl.join(directory, entry.name),
          depth: depth + 1,
        });
      }
    }
  }
  return false;
}

/**
 * Projects are workspaces with a locally verifiable marker (either at the
 * cwd, at any ancestor, or — bounded — anywhere inside the cwd tree). A
 * readable cwd without one is a quick conversation; a stale/unreadable cwd
 * stays unknown.
 */
export async function classifyDashboardProjectRef(
  project: string,
  options: ProjectClassificationOptions = {},
): Promise<DashboardProjectClassification> {
  const home = options.home ?? homedir();
  const pathImpl = pathImplForPlatform(options.platform ?? process.platform);
  const initial = normaliseProjectRefFor(pathImpl, project, home);
  if (initial == null) return { kind: "unknown", label: "unknown" };
  if (!(await isDirectory(initial)))
    return { kind: "unknown", label: "unknown" };

  // Repository identity wins over nested language/package markers. Sessions
  // anywhere inside one checkout therefore aggregate under the same project.
  const gitRoot = await findNearestGitRepositoryRoot(pathImpl, initial);
  if (gitRoot != null) {
    return {
      kind: "workspace",
      label: pathImpl.basename(gitRoot) || "workspace",
    };
  }

  const homePath = pathImpl.resolve(home);
  let directory = pathImpl.resolve(initial);
  while (true) {
    if (
      (
        await Promise.all(
          workspaceMarkers
            .slice(1)
            .map((marker) => hasMarker(pathImpl, directory, marker)),
        )
      ).some(Boolean) ||
      (directory === pathImpl.resolve(initial) &&
        (await hasWorkspaceMarkerInSubtree(pathImpl, directory)))
    ) {
      return {
        kind: "workspace",
        label: pathImpl.basename(directory) || "workspace",
      };
    }
    if (directory === homePath || directory === pathImpl.dirname(directory))
      break;
    directory = pathImpl.dirname(directory);
  }
  return { kind: "quick-conversation", label: "quick-conversation" };
}

export async function classifyDashboardProjectRefs(
  projects: readonly string[],
  options: ProjectClassificationOptions = {},
): Promise<ReadonlyMap<string, DashboardProjectClassification>> {
  const classifications = await Promise.all(
    [...new Set(projects)].map(
      async (project) =>
        [project, await classifyDashboardProjectRef(project, options)] as const,
    ),
  );
  return new Map(classifications);
}
