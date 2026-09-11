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
 * the cloud-provider folders, mounted volumes) are the one exception: they are
 * never resolved on disk, so they keep their lexical form and report
 * `isGitProject: false`. Reading them would raise a "…would like to access
 * files in your Documents folder" prompt, and — because this build is ad-hoc
 * signed — macOS could not even remember the answer: TCC stores a code
 * requirement that collapses to the binary's cdhash for ad-hoc signatures, so
 * every rebuilt bundle looks like a new app and asks again.
 *
 * The visible identity is identical either way (the display contract is
 * home-relative, so `~/Documents/Dev/repo/src/feature` stays that string), so
 * the only thing given up is collapsing a nested cwd onto its repository root.
 * Features that key off `isGitProject` — project-level distillation grouping —
 * therefore skip protected projects. To trade the prompt back for that
 * grouping, sign the app with a stable certificate (see
 * `electron/after-pack.cjs`) and drop the {@link isTccProtectedPathFor} guard
 * below.
 */
export async function canonicalizeProjectPathDetailsFor(
  pathImpl: ProjectPathImpl,
  project: string,
  homeDirectory: string,
  platform: NodeJS.Platform = process.platform,
): Promise<CanonicalProjectIdentity> {
  const normalizedHome = pathImpl.normalize(homeDirectory);
  const expanded = expandProjectPathFor(pathImpl, project, normalizedHome);
  if (expanded == null) {
    return { project: project.trim() || project, isGitProject: false };
  }

  if (isTccProtectedPathFor(pathImpl, expanded, normalizedHome, platform)) {
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
): Promise<string> {
  return (
    await canonicalizeProjectPathDetailsFor(
      pathImpl,
      project,
      homeDirectory,
      platform,
    )
  ).project;
}

/** Bind {@link canonicalizeProjectPathDetailsFor} to the requested platform. */
export function canonicalizeProjectIdentity(
  project: string,
  homeDirectory: string,
  platform: NodeJS.Platform = process.platform,
): Promise<CanonicalProjectIdentity> {
  return canonicalizeProjectPathDetailsFor(
    pathImplForRecordedProject(project, platform),
    project,
    homeDirectory,
    platform,
  );
}

/** Bind {@link canonicalizeProjectPathFor} to the requested platform. */
export function canonicalizeProjectPath(
  project: string,
  homeDirectory: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string> {
  return canonicalizeProjectPathFor(
    pathImplForRecordedProject(project, platform),
    project,
    homeDirectory,
    platform,
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
