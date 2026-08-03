import { createServerFn } from "@tanstack/react-start";
import { homedir } from "node:os";
import { join } from "node:path";
import { lstat, readdir, rm } from "node:fs/promises";

/**
 * FR-029 / NFR-023 — local data lifecycle helpers.
 *
 * TrustTools stores everything under `~/.trusttools/`. This module reports the
 * on-disk footprint (so the settings page can show "当前占用 XMB / 500MB") and
 * prunes obsolete cache artifacts. It never touches AI-tool logs or user
 * configs outside `~/.trusttools/`.
 */

const LEGACY_INDEX_FILES = [
  "local-usage-index-v1.json",
  "local-usage-index-v2.json",
  "local-usage-index-v3.json",
  "local-usage-index-v4.json",
  "local-usage-index-v5.json",
  "local-usage-index-v6.json",
  "local-usage-index-v7.json",
  "local-usage-index-v8.json",
  "local-usage-index-v9.json",
];

/** NFR-023 soft cap shown in the UI. */
export const STORAGE_SOFT_CAP_BYTES = 500 * 1024 * 1024;

export function trusttoolsDirectory(): string {
  const override = process.env.TRUSTTOOLS_HOME;
  if (override && override.length > 0) return override;
  return join(homedir(), ".trusttools");
}

/** Recursively sum the byte size of a directory tree. Symlink-safe. */
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

export interface StorageUsage {
  directory: string;
  bytes: number;
  fileCount: number;
  softCapBytes: number;
  /** 0..1 fraction of the soft cap currently used. */
  utilization: number;
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
  };
}

/**
 * Delete obsolete local-usage index versions (v1..v9) left over from older
 * releases. The current index (v10) is always preserved. Returns the file
 * names actually removed.
 */
export async function pruneLegacyIndices(): Promise<string[]> {
  const cacheDir = join(trusttoolsDirectory(), "cache");
  const removed: string[] = [];
  for (const name of LEGACY_INDEX_FILES) {
    const target = join(cacheDir, name);
    try {
      const stats = await lstat(target);
      if (stats.isFile() || stats.isSymbolicLink()) {
        await rm(target, { force: true });
        removed.push(name);
      }
    } catch {
      // not present — skip
    }
  }
  return removed;
}

/** Read the configured retention window (days) from prefs, default 90. */
export async function readRetentionDays(): Promise<number> {
  let prefsDir: string;
  try {
    const { app } = await import("electron");
    prefsDir = app.getPath("userData");
  } catch {
    prefsDir = join(homedir(), ".trusttools");
  }
  const prefsPath = join(prefsDir, "trusttools-prefs.json");
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(prefsPath, "utf8");
    const prefs = JSON.parse(raw) as Record<string, unknown>;
    const value = prefs["trusttools.settings.retentionDays"];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      // 0 means "forever" in the UI; treat anything <= 0 as infinite.
      return Number.POSITIVE_INFINITY;
    }
    if (typeof value === "string") {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  } catch {
    // prefs missing/invalid — default
  }
  return 90;
}

export const getStorageUsageFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<StorageUsage> => readStorageUsage(),
);

export const pruneLocalDataFn = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ removedLegacyIndices: string[]; usage: StorageUsage }> => {
    const removedLegacyIndices = await pruneLegacyIndices();
    const usage = await readStorageUsage();
    return { removedLegacyIndices, usage };
  },
);
