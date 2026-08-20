import { readFile, stat } from "node:fs/promises";
import { posix, win32 } from "node:path";

export type ServerPathImpl = typeof win32;

const GITDIR_LINE_RE = /^gitdir:\s*(.+)\s*$/im;
const gitRootCache = new Map<string, Promise<string | null>>();
const MAX_GIT_ROOT_CACHE_ENTRIES = 4_096;

function cacheKey(pathImpl: ServerPathImpl, directory: string): string {
  return `${pathImpl === win32 ? "win32" : "posix"}:${directory}`;
}

/**
 * Validate a normal checkout (`.git` directory) or a worktree/submodule
 * checkout (`.git` file with a live `gitdir:` target).
 */
export async function isGitRepositoryRoot(
  pathImpl: ServerPathImpl,
  directory: string,
): Promise<boolean> {
  const gitPath = pathImpl.join(directory, ".git");
  let gitStat;
  try {
    gitStat = await stat(gitPath);
  } catch {
    return false;
  }
  if (gitStat.isDirectory()) return true;
  if (!gitStat.isFile()) return false;

  let content: string;
  try {
    content = await readFile(gitPath, "utf8");
  } catch {
    return false;
  }
  const match = GITDIR_LINE_RE.exec(content);
  if (match == null) return false;
  const gitDirectory = pathImpl.resolve(directory, match[1].trim());
  try {
    return (await stat(gitDirectory)).isDirectory();
  } catch {
    return false;
  }
}

async function findGitRootUncached(
  pathImpl: ServerPathImpl,
  initialDirectory: string,
): Promise<string | null> {
  if (!pathImpl.isAbsolute(initialDirectory)) return null;
  let directory = pathImpl.resolve(initialDirectory);
  while (true) {
    if (await isGitRepositoryRoot(pathImpl, directory)) return directory;
    const parent = pathImpl.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

/**
 * Return the nearest valid Git repository ancestor. Results are bounded and
 * memoized because one scan commonly resolves hundreds of sessions from the
 * same handful of working directories.
 */
export function findNearestGitRepositoryRoot(
  pathImpl: ServerPathImpl,
  initialDirectory: string,
): Promise<string | null> {
  const normalized = pathImpl.normalize(initialDirectory);
  const key = cacheKey(pathImpl, normalized);
  const cached = gitRootCache.get(key);
  if (cached != null) return cached;
  if (gitRootCache.size >= MAX_GIT_ROOT_CACHE_ENTRIES) gitRootCache.clear();
  const pending = findGitRootUncached(pathImpl, normalized).then((root) => {
    // Do not make a pre-`git init` miss permanent in a long-lived desktop
    // process. Successful roots are stable enough to retain; misses are only
    // deduplicated while their filesystem probe is in flight.
    if (root == null) gitRootCache.delete(key);
    return root;
  });
  gitRootCache.set(key, pending);
  return pending;
}

export function serverPathImplForPlatform(
  platform: NodeJS.Platform,
): ServerPathImpl {
  return platform === "win32" ? win32 : posix;
}
