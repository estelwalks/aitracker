import { realpath } from "node:fs/promises";

import {
  findNearestGitRepositoryRoot,
  serverPathImplForPlatform,
} from "../git-repository.server.ts";
import {
  normalizeProjectPathFor,
  type ProjectPathImpl,
} from "./project-path.ts";

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
