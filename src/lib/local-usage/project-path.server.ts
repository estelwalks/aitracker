import { realpath } from "node:fs/promises";
import { posix } from "node:path";

import {
  findNearestGitRepositoryRoot,
  serverPathImplForPlatform,
} from "../git-repository.server.ts";
import {
  isTccProtectedPathFor,
  normalizeProjectPathFor,
  type ProjectPathImpl,
} from "./project-path.ts";

export interface CanonicalProjectIdentity {
  readonly project: string;
  readonly isGitProject: boolean;
}

export interface CanonicalProjectPathOptions {
  /**
   * Allow filesystem probing under macOS TCC-protected directories. Packaged
   * builds enable this only after they have a stable certificate; development
   * builds keep the prompt-free fallback unless explicitly opted in.
   */
  readonly allowTccProtectedPathProbe?: boolean;
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
 *
 * Paths under a macOS TCC-protected directory (Documents, Desktop, Downloads,
 * the cloud-provider folders, mounted volumes) use a prompt-free lexical
 * fallback by default. A packaged build with a stable certificate can opt into
 * resolving them after the user grants access, which restores repository-root
 * grouping without making ad-hoc development builds prompt on every rebuild.
 *
 * The visible identity is identical either way (the display contract is
 * home-relative, so `~/Documents/Dev/repo/src/feature` stays that string).
 * Without the opt-in, the only thing given up is collapsing a nested cwd onto
 * its repository root. To trade the prompt back for that grouping, sign the
 * app with a stable certificate (see `electron/after-pack.cjs`) and enable
 * {@link CanonicalProjectPathOptions.allowTccProtectedPathProbe}.
 */
export async function canonicalizeProjectPathDetailsFor(
  pathImpl: ProjectPathImpl,
  project: string,
  homeDirectory: string,
  platform: NodeJS.Platform = process.platform,
  options: CanonicalProjectPathOptions = {},
): Promise<CanonicalProjectIdentity> {
  const normalizedHome = pathImpl.normalize(homeDirectory);
  const expanded = expandProjectPathFor(pathImpl, project, normalizedHome);
  if (expanded == null) {
    return { project: project.trim() || project, isGitProject: false };
  }

  if (
    !options.allowTccProtectedPathProbe &&
    isTccProtectedPathFor(pathImpl, expanded, normalizedHome, platform)
  ) {
    return {
      project: normalizeProjectPathFor(pathImpl, expanded, normalizedHome),
      isGitProject: false,
    };
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
  platform: NodeJS.Platform = process.platform,
  options: CanonicalProjectPathOptions = {},
): Promise<string> {
  return (
    await canonicalizeProjectPathDetailsFor(
      pathImpl,
      project,
      homeDirectory,
      platform,
      options,
    )
  ).project;
}

/** Bind {@link canonicalizeProjectPathDetailsFor} to the requested platform. */
export function canonicalizeProjectIdentity(
  project: string,
  homeDirectory: string,
  platform: NodeJS.Platform = process.platform,
  options: CanonicalProjectPathOptions = {},
): Promise<CanonicalProjectIdentity> {
  return canonicalizeProjectPathDetailsFor(
    pathImplForRecordedProject(project, platform),
    project,
    homeDirectory,
    platform,
    options,
  );
}

/** Bind {@link canonicalizeProjectPathFor} to the requested platform. */
export function canonicalizeProjectPath(
  project: string,
  homeDirectory: string,
  platform: NodeJS.Platform = process.platform,
  options: CanonicalProjectPathOptions = {},
): Promise<string> {
  return canonicalizeProjectPathFor(
    pathImplForRecordedProject(project, platform),
    project,
    homeDirectory,
    platform,
    options,
  );
}

/**
 * Recorded project/cwd values keep the path semantics of the machine that
 * produced them. A POSIX-style value such as `/Users/…` read on Windows must
 * not be reinterpreted as a Windows root-relative path (`\Users\…`) — that
 * would mangle projects imported from other machines and from fixtures. Real
 * Windows values carry a drive letter or a native backslash form, so they are
 * resolved with the win32 implementation regardless of this rule.
 */
function pathImplForRecordedProject(
  project: string,
  platform: NodeJS.Platform,
): ProjectPathImpl {
  if (platform === "win32" && project.startsWith("/")) {
    return posix;
  }
  return serverPathImplForPlatform(platform);
}
