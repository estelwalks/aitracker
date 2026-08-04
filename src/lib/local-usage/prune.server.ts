import { createServerFn } from "@tanstack/react-start";
import { lstat, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";

/**
 * FR-029 / NFR-023 — AITracker-owned local data lifecycle helpers.
 *
 * The scanner reads third-party AI-tool logs in place. Those logs are never
 * considered application storage and are never traversed or removed here.
 * The only destructive operations in this module are limited to the selected
 * AITracker data root's `cache/` directory (indexes and market cache can be
 * regenerated from their original local sources).
 */

const CACHE_DIRECTORY = "cache";
const DATA_ROOT_MARKER = ".trusttools-data-root";
const DAY_MS = 24 * 60 * 60 * 1_000;

/** NFR-023 soft cap shown in the UI. */
export const STORAGE_SOFT_CAP_BYTES = 500 * 1024 * 1024;

export interface StorageUsage {
  directory: string;
  bytes: number;
  fileCount: number;
  softCapBytes: number;
  /** 0..1 fraction of the soft cap currently used. */
  utilization: number;
  exceedsSoftCap: boolean;
  /** A custom location needs the marker written by Electron before pruning. */
  controlled: boolean;
}

export interface CleanupStats {
  removedFiles: number;
  removedBytes: number;
  retainedFiles: number;
  retentionDays: number;
  skipped: boolean;
  reason?: string;
}

export function defaultAITrackerDirectory(homeDirectory = homedir()): string {
  return join(homeDirectory, ".trusttools");
}

/**
 * Electron sets TRUSTTOOLS_HOME from the saved data-path preference. The
 * environment override is also useful for isolated test/install environments.
 */
export function trusttoolsDirectory(): string {
  const override = process.env.TRUSTTOOLS_HOME?.trim();
  return override ? resolve(override) : defaultAITrackerDirectory();
}

function isInside(parent: string, candidate: string): boolean {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent === "" ||
    (!pathFromParent.startsWith("..") && !pathFromParent.startsWith("/"))
  );
}

/** Recursively sum a directory tree. Symlinks are neither followed nor counted. */
export async function directorySize(
  directory: string,
): Promise<{ bytes: number; fileCount: number }> {
  let bytes = 0;
  let fileCount = 0;
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return { bytes: 0, fileCount: 0 };
  }
  for (const entry of entries) {
    const full = join(directory, entry);
    let stats;
    try {
      stats = await lstat(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      const sub = await directorySize(full);
      bytes += sub.bytes;
      fileCount += sub.fileCount;
    } else if (stats.isFile()) {
      bytes += stats.size;
      fileCount += 1;
    }
  }
  return { bytes, fileCount };
}

export async function isControlledAITrackerDirectory(
  directory = trusttoolsDirectory(),
): Promise<boolean> {
  const root = resolve(directory);
  if (root === resolve(defaultAITrackerDirectory())) return true;
  try {
    return (await lstat(join(root, DATA_ROOT_MARKER))).isFile();
  } catch {
    return false;
  }
}

export async function readStorageUsage(): Promise<StorageUsage> {
  const directory = trusttoolsDirectory();
  const { bytes, fileCount } = await directorySize(directory);
  return {
    directory,
    bytes,
    fileCount,
    softCapBytes: STORAGE_SOFT_CAP_BYTES,
    utilization: Math.min(1, bytes / STORAGE_SOFT_CAP_BYTES),
    exceedsSoftCap: bytes >= STORAGE_SOFT_CAP_BYTES,
    controlled: await isControlledAITrackerDirectory(directory),
  };
}

function emptyCleanup(retentionDays: number, reason?: string): CleanupStats {
  const cleanup: CleanupStats = {
    removedFiles: 0,
    removedBytes: 0,
    retainedFiles: 0,
    retentionDays,
    skipped: Boolean(reason),
  };
  if (reason) cleanup.reason = reason;
  return cleanup;
}

/**
 * Walk only the controlled `cache/` directory. `rm` is called for individual
 * regular files/symlinks only, so an unexpected directory or external link
 * cannot broaden deletion scope.
 */
async function pruneCacheFiles(
  shouldRemove: (modifiedAt: number) => boolean,
  retentionDays: number,
  directory = trusttoolsDirectory(),
): Promise<CleanupStats> {
  const root = resolve(directory);
  const cacheDirectory = resolve(root, CACHE_DIRECTORY);
  if (!isInside(root, cacheDirectory)) {
    return emptyCleanup(retentionDays, "缓存目录不在 AITracker 数据目录内");
  }
  if (!(await isControlledAITrackerDirectory(root))) {
    return emptyCleanup(
      retentionDays,
      "数据目录未经 AITracker 验证，未执行清理",
    );
  }

  const result = emptyCleanup(retentionDays);
  const visit = async (current: string): Promise<void> => {
    let entries: string[];
    try {
      entries = await readdir(current);
    } catch {
      return;
    }
    for (const entry of entries) {
      const target = resolve(current, entry);
      if (!isInside(cacheDirectory, target)) continue;
      let stats;
      try {
        stats = await lstat(target);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        await visit(target);
        continue;
      }
      if (!stats.isFile() && !stats.isSymbolicLink()) continue;
      if (!shouldRemove(stats.mtimeMs)) {
        result.retainedFiles += 1;
        continue;
      }
      try {
        await rm(target, { force: true });
        result.removedFiles += 1;
        // A symlink's target is never followed, so its contribution is zero.
        if (stats.isFile()) result.removedBytes += stats.size;
      } catch {
        result.retainedFiles += 1;
      }
    }
  };
  await visit(cacheDirectory);
  return result;
}

/**
 * Remove expired, regenerable cache files. A permanent retention policy (0)
 * deliberately does no deletion. Token source logs and non-cache AITracker
 * configuration are outside this operation's scope.
 */
export async function pruneExpiredCacheFiles(
  retentionDays: number,
  now = new Date(),
  directory = trusttoolsDirectory(),
): Promise<CleanupStats> {
  if (!Number.isFinite(retentionDays) || retentionDays < 0) {
    throw new Error("保留天数必须为非负整数");
  }
  if (retentionDays === 0) return emptyCleanup(0);
  const cutoff = now.getTime() - retentionDays * DAY_MS;
  return pruneCacheFiles(
    (modifiedAt) => modifiedAt < cutoff,
    retentionDays,
    directory,
  );
}

/** Clear every regenerable file inside AITracker' controlled cache directory. */
export async function clearRegenerableCache(
  directory = trusttoolsDirectory(),
): Promise<CleanupStats> {
  return pruneCacheFiles(() => true, 0, directory);
}

export const getStorageUsageFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<StorageUsage> => readStorageUsage(),
);

export const applyRetentionPolicyFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { retentionDays: number } => {
    if (
      typeof data !== "object" ||
      data === null ||
      !Number.isInteger((data as { retentionDays?: unknown }).retentionDays)
    ) {
      throw new Error("保留天数必须为非负整数");
    }
    const retentionDays = (data as { retentionDays: number }).retentionDays;
    if (retentionDays < 0 || retentionDays > 3650) {
      throw new Error("保留天数超出允许范围");
    }
    return { retentionDays };
  })
  .handler(
    async ({
      data,
    }): Promise<{ cleanup: CleanupStats; usage: StorageUsage }> => {
      const cleanup = await pruneExpiredCacheFiles(data.retentionDays);
      return { cleanup, usage: await readStorageUsage() };
    },
  );

export const clearRegenerableCacheFn = createServerFn({
  method: "POST",
}).handler(
  async (): Promise<{ cleanup: CleanupStats; usage: StorageUsage }> => {
    const cleanup = await clearRegenerableCache();
    return { cleanup, usage: await readStorageUsage() };
  },
);
