import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, normalize, resolve } from "node:path";

/**
 * A project label is decided on the server from local workspace evidence.
 * Browser DTOs receive only this label and kind, never a cwd or marker path.
 */
export type DashboardProjectKind =
  "workspace" | "quick-conversation" | "unknown";

export interface DashboardProjectClassification {
  readonly kind: DashboardProjectKind;
  /** Display-safe label; it is never a filesystem path. */
  readonly label: string;
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

function normaliseProjectRef(project: string, home: string): string | null {
  const value = project.trim().replaceAll("\\", "/").replace(/\/+$/u, "");
  if (!value || value === "unknown") return null;
  if (value === "~") return home;
  if (value.startsWith("~/")) return join(home, value.slice(2));
  return value.startsWith("/") ? normalize(value) : null;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function hasMarker(directory: string, marker: string): Promise<boolean> {
  try {
    await access(join(directory, marker));
    return true;
  } catch {
    return false;
  }
}

/**
 * Projects are workspaces with a locally verifiable marker. A readable cwd
 * without one is a quick conversation; a stale/unreadable cwd stays unknown.
 */
export async function classifyDashboardProjectRef(
  project: string,
  options: { readonly home?: string } = {},
): Promise<DashboardProjectClassification> {
  const home = options.home ?? homedir();
  const initial = normaliseProjectRef(project, home);
  if (initial == null) return { kind: "unknown", label: "unknown" };
  if (!(await isDirectory(initial)))
    return { kind: "unknown", label: "unknown" };

  const homePath = resolve(home);
  let directory = resolve(initial);
  while (true) {
    if (await hasMarker(directory, ".git")) {
      return { kind: "workspace", label: basename(directory) || "workspace" };
    }
    if (
      (
        await Promise.all(
          workspaceMarkers
            .slice(1)
            .map((marker) => hasMarker(directory, marker)),
        )
      ).some(Boolean)
    ) {
      // A nested package is a separate local project even when it is checked
      // into a parent repository (for example, a prototype inside a monorepo).
      return { kind: "workspace", label: basename(directory) || "workspace" };
    }
    if (directory === homePath || directory === dirname(directory)) break;
    directory = dirname(directory);
  }
  return { kind: "quick-conversation", label: "quick-conversation" };
}

export async function classifyDashboardProjectRefs(
  projects: readonly string[],
  options: { readonly home?: string } = {},
): Promise<ReadonlyMap<string, DashboardProjectClassification>> {
  const classifications = await Promise.all(
    [...new Set(projects)].map(
      async (project) =>
        [project, await classifyDashboardProjectRef(project, options)] as const,
    ),
  );
  return new Map(classifications);
}
