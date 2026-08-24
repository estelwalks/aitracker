import { lstat, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { getCompositionRoot } from "../../app/composition.server";
import { APP_DATA_DIR, ENV } from "../../lib/app-config";
import {
  applyDatabaseRetention,
  clearRegenerableDatabaseCaches,
} from "../../platform/database/retention.server";

/**
 * Settings data-lifecycle facade (FR-029 / NFR-023).
 *
 * Retention and cache clearing are now database-backed (S-03): the app-owned
 * caches live in the SQLite `http_cache_entries` and `insight_enhancement_cache`
 * tables, and are no longer files under `~/.trusttools/cache/`. Only the
 * storage-usage readout still walks the filesystem to measure the app data
 * directory size — a diagnostic, never a destructive operation.
 */

export const STORAGE_SOFT_CAP_BYTES = 500 * 1024 * 1024;

export interface StorageUsage {
  directory: string;
  bytes: number;
  fileCount: number;
  softCapBytes: number;
  /** 0..1 fraction of the soft cap currently used. */
  utilization: number;
  exceedsSoftCap: boolean;
  /** The app data root is always the controlled SQLite data directory. */
  controlled: boolean;
}

export interface CleanupStats {
  /** Deleted cache rows (formerly deleted files). */
  removedFiles: number;
  /** Database rows carry no file size, so this is always 0. */
  removedBytes: number;
  retainedFiles: number;
  retentionDays: number;
  skipped: boolean;
  reason?: string;
}

function dataDirectory(): string {
  const override = process.env[ENV.HOME]?.trim();
  return override ? resolve(override) : join(homedir(), APP_DATA_DIR);
}

/** Recursively sum a directory tree. Symlinks are neither followed nor counted. */
async function directorySize(
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

export async function readStorageUsage(): Promise<StorageUsage> {
  const directory = dataDirectory();
  const { bytes, fileCount } = await directorySize(directory);
  return {
    directory,
    bytes,
    fileCount,
    softCapBytes: STORAGE_SOFT_CAP_BYTES,
    utilization: Math.min(1, bytes / STORAGE_SOFT_CAP_BYTES),
    exceedsSoftCap: bytes >= STORAGE_SOFT_CAP_BYTES,
    controlled: true,
  };
}

function cleanupFromSummary(
  retentionDays: number,
  summary: { httpCacheDeleted: number; insightCacheDeleted: number },
): CleanupStats {
  return {
    removedFiles: summary.httpCacheDeleted + summary.insightCacheDeleted,
    removedBytes: 0,
    retainedFiles: 0,
    retentionDays,
    skipped: false,
  };
}

/**
 * Applies the already-validated retention setting within the server process.
 *
 * This deliberately remains a plain server helper so the public settings RPC
 * can execute the operation in the same server process.
 */
export async function applyRetentionPolicy(
  retentionDays: number,
): Promise<{ cleanup: CleanupStats; usage: StorageUsage }> {
  const root = await getCompositionRoot();
  const summary = applyDatabaseRetention(root.database.database, Date.now());
  return {
    cleanup: cleanupFromSummary(retentionDays, summary),
    usage: await readStorageUsage(),
  };
}

/** Clears regenerable database caches within the server process. */
export async function clearRegenerableCache(): Promise<{
  cleanup: CleanupStats;
  usage: StorageUsage;
}> {
  const root = await getCompositionRoot();
  const summary = clearRegenerableDatabaseCaches(root.database.database);
  return {
    cleanup: cleanupFromSummary(0, summary),
    usage: await readStorageUsage(),
  };
}
