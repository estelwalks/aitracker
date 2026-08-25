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
 * Retention and cache clearing are database-backed (S-03): HTTP/insight cache
 * rows live in SQLite, while manual clearing also drops regenerable snapshot,
 * search and classification indexes. The storage readout walks the filesystem
 * only to measure the app data directory; it is never destructive.
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
  /** Deleted cache/index entries (formerly deleted files). */
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
  summary: {
    httpCacheDeleted: number;
    insightCacheDeleted: number;
    regenerableIndexDeleted?: number;
  },
  removedBytes = 0,
): CleanupStats {
  return {
    removedFiles:
      summary.httpCacheDeleted +
      summary.insightCacheDeleted +
      (summary.regenerableIndexDeleted ?? 0),
    removedBytes,
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
  const before = await readStorageUsage();
  const database = root.database.database;
  const countRows = (table: string): number =>
    Number(
      database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count ??
        0,
    );
  const regenerableIndexDeleted = [
    "snapshot_generations",
    "search_documents",
    "project_classifications",
  ].reduce((total, table) => total + countRows(table), 0);

  // Clear the in-memory coordinators and their persisted generations together;
  // otherwise a dashboard can continue serving the old snapshot after the
  // database rows have been removed.
  await Promise.all([
    root.usageSnapshot.clear(),
    root.sessionSnapshot.clear(),
    root.skillSnapshot.clear(),
    root.installationSnapshot.clear(),
    root.wslSnapshot.clear(),
    root.database.features.classifications.clear(),
  ]);
  const searchResult = await root.searchIndex.rebuildFromSnapshots([]);
  if (!searchResult.ok) throw new Error("search index cache clear failed");
  const summary = clearRegenerableDatabaseCaches(root.database.database);
  // DELETE only marks SQLite pages as reusable. Compact the database and
  // truncate the WAL so the storage readout reflects the reclaimed space.
  try {
    root.database.compact();
  } catch (error) {
    // Cache rows are already gone; a transient checkpoint/VACUUM failure must
    // not turn a successful clear into a misleading error toast.
    console.warn("AITracker cache compaction failed", error);
  }
  const usage = await readStorageUsage();
  return {
    cleanup: cleanupFromSummary(
      0,
      { ...summary, regenerableIndexDeleted },
      Math.max(0, before.bytes - usage.bytes),
    ),
    usage,
  };
}
