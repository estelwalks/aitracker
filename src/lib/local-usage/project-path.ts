import { realpath } from "node:fs/promises";
import { posix, win32 } from "node:path";

import {
  findNearestGitRepositoryRoot,
  serverPathImplForPlatform,
} from "../git-repository.server.ts";

/**
 * Project-path normalization shared by the usage scanner.
 *
 * Display contract (privacy + readability): the user's home itself becomes
 * "~", paths under the home become "~/<relative>", and everything else keeps
 * its original form — including Windows cross-drive absolute paths
 * (C:\home vs D:\project), external absolute paths, and relative paths.
 *
 * The function is parameterized over a path implementation (`win32` / `posix`)
 * so the Windows cross-drive behavior is verifiable on any host. The default
 * export binds the running platform.
 *
 * Cross-drive subtlety: `win32.relative("C:\\Users\\u", "D:\\Dev\\a")` returns
 * the absolute path "D:\\Dev\\a" itself rather than a ".."-relative segment,
 * so a naive `~/` prefix would mangle it into "~/D:/Dev/a" and drop the
 * project out of the dashboard project overview. `isAbsolute(relativeProject)`
 * detects exactly that case: it is never true for a POSIX relative() result.
 */
export type ProjectPathImpl = typeof win32;

export function normalizeProjectPathFor(
  pathImpl: ProjectPathImpl,
  project: string,
  homeDirectory: string,
): string {
  if (project === homeDirectory) {
    return "~";
  }

  const relativeProject = pathImpl.relative(homeDirectory, project);
  const underHome =
    relativeProject !== ".." &&
    !relativeProject.startsWith(`..${pathImpl.sep}`);
  if (
    pathImpl.isAbsolute(project) &&
    underHome &&
    !pathImpl.isAbsolute(relativeProject)
  ) {
    return `~/${relativeProject.split(pathImpl.sep).join("/")}`;
  }

  return project;
}

const platformPath: ProjectPathImpl =
  process.platform === "win32" ? win32 : posix;

/** Bind {@link normalizeProjectPathFor} to the running platform. */
export function normalizeProjectPath(
  project: string,
  homeDirectory: string,
): string {
  return normalizeProjectPathFor(platformPath, project, homeDirectory);
}

export interface CanonicalProjectIdentity {
  readonly project: string;
  readonly isGitProject: boolean;
}

function expandProjectPathFor(
  pathImpl: ProjectPathImpl,
  project: string,
  homeDirectory: string,
): string | undefined {
  const candidate = project.trim();
  if (!candidate) return undefined;
  if (candidate === "~") return pathImpl.normalize(homeDirectory);
  if (candidate.startsWith("~/") || candidate.startsWith("~\\")) {
    return pathImpl.normalize(pathImpl.join(homeDirectory, candidate.slice(2)));
  }
  if (!pathImpl.isAbsolute(candidate)) return undefined;
  return pathImpl.normalize(candidate);
}

/**
 * Return the stable project identity used by usage aggregation.
 *
 * Absolute paths and home-relative paths are first normalized to one platform
 * representation. When the directory belongs to a Git repository, the
 * repository root becomes the identity so sessions recorded from nested
 * working directories share one project bucket. Non-path values such as
 * `unknown` and `quick-conversation` are preserved for classification.
 */
export async function canonicalizeProjectPathDetailsFor(
  pathImpl: ProjectPathImpl,
  project: string,
  homeDirectory: string,
): Promise<CanonicalProjectIdentity> {
  const normalizedHome = pathImpl.normalize(homeDirectory);
  const expanded = expandProjectPathFor(pathImpl, project, normalizedHome);
  if (expanded == null) {
    return { project: project.trim() || project, isGitProject: false };
  }

  let canonicalPath = expanded;
  let outputHome = normalizedHome;
  try {
    canonicalPath = pathImpl.normalize(await realpath(expanded));
    try {
      outputHome = pathImpl.normalize(await realpath(normalizedHome));
    } catch {
      // Keep the lexical home when only the project path is unavailable.
    }
  } catch {
    // Usage logs can outlive a deleted checkout. Keep the normalized path so
    // those records remain stable and can still be classified as unknown.
  }

  const gitRoot = await findNearestGitRepositoryRoot(pathImpl, canonicalPath);
  return {
    project: normalizeProjectPathFor(
      pathImpl,
      gitRoot ?? canonicalPath,
      outputHome,
    ),
    isGitProject: gitRoot != null,
  };
}

export async function canonicalizeProjectPathFor(
  pathImpl: ProjectPathImpl,
  project: string,
  homeDirectory: string,
): Promise<string> {
  return (
    await canonicalizeProjectPathDetailsFor(pathImpl, project, homeDirectory)
  ).project;
}

/** Bind {@link canonicalizeProjectPathDetailsFor} to the requested platform. */
export function canonicalizeProjectIdentity(
  project: string,
  homeDirectory: string,
  platform: NodeJS.Platform = process.platform,
): Promise<CanonicalProjectIdentity> {
  return canonicalizeProjectPathDetailsFor(
    serverPathImplForPlatform(platform),
    project,
    homeDirectory,
  );
}

/** Bind {@link canonicalizeProjectPathFor} to the requested platform. */
export function canonicalizeProjectPath(
  project: string,
  homeDirectory: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string> {
  return canonicalizeProjectPathFor(
    serverPathImplForPlatform(platform),
    project,
    homeDirectory,
  );
}
