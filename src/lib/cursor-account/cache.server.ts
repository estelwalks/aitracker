import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { CursorUsageCacheRecord } from "./csv.server.ts";

/**
 * On-disk cache for the opt-in Cursor account export.
 *
 * The network collector owns this file; the local usage scanner only reads it,
 * so an offline scan can never trigger a request and the network task can never
 * write into the snapshot directly. The cache is pruned to the newest records:
 * the scanner reads whole files and enforces its own byte cap, so an unbounded
 * account export must not be mirrored verbatim.
 */
export const CURSOR_USAGE_CACHE_VERSION = 1 as const;
export const MAX_CACHED_CURSOR_RECORDS = 20_000;

export interface CursorUsageCacheFile {
  readonly version: typeof CURSOR_USAGE_CACHE_VERSION;
  readonly syncedAt: string;
  readonly source: "cursor";
  /**
   * Records live under `events` on purpose: that is one of the registry's
   * default generic-record paths, so the offline scanner reads this file with
   * its standard mapping instead of a Cursor-specific one.
   */
  readonly events: readonly CursorUsageCacheRecord[];
}

function recordKey(record: CursorUsageCacheRecord): string {
  return [
    record.timestamp,
    record.session_id,
    record.model,
    record.usage.input_tokens,
    record.usage.output_tokens,
  ].join("|");
}

/**
 * Merges a fresh export over the cached history.
 *
 * Cursor's export is authoritative only for the window it covers: rows inside
 * that window replace whatever we cached for the same request (corrections,
 * late retries), while older rows are kept because a truncated/windowed export
 * must not erase history AITracker already collected.
 */
export function mergeCursorUsageRecords(
  existing: readonly CursorUsageCacheRecord[],
  incoming: readonly CursorUsageCacheRecord[],
): CursorUsageCacheRecord[] {
  if (incoming.length === 0) return [...existing];
  let earliest = incoming[0].timestamp;
  for (const record of incoming) {
    if (record.timestamp < earliest) earliest = record.timestamp;
  }
  const merged = new Map<string, CursorUsageCacheRecord>();
  for (const record of existing) {
    if (record.timestamp >= earliest) continue;
    merged.set(recordKey(record), record);
  }
  for (const record of incoming) {
    merged.set(recordKey(record), record);
  }
  return [...merged.values()].sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp),
  );
}

export interface CursorUsageCacheWriteResult {
  readonly written: number;
  readonly truncated: boolean;
}

export async function writeCursorUsageCache(
  cachePath: string,
  records: readonly CursorUsageCacheRecord[],
  syncedAt: string,
): Promise<CursorUsageCacheWriteResult> {
  const truncated = records.length > MAX_CACHED_CURSOR_RECORDS;
  const kept = truncated
    ? records.slice(records.length - MAX_CACHED_CURSOR_RECORDS)
    : records;
  const file: CursorUsageCacheFile = {
    version: CURSOR_USAGE_CACHE_VERSION,
    syncedAt,
    source: "cursor",
    events: kept,
  };
  await mkdir(dirname(cachePath), { recursive: true });
  const temporaryPath = `${cachePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(file), "utf8");
  await rename(temporaryPath, cachePath);
  return { written: kept.length, truncated };
}

export async function readCursorUsageCache(
  cachePath: string,
): Promise<CursorUsageCacheFile | null> {
  try {
    const parsed = JSON.parse(await readFile(cachePath, "utf8")) as unknown;
    if (parsed == null || typeof parsed !== "object") return null;
    const file = parsed as Partial<CursorUsageCacheFile>;
    if (
      file.version !== CURSOR_USAGE_CACHE_VERSION ||
      file.source !== "cursor" ||
      !Array.isArray(file.events) ||
      typeof file.syncedAt !== "string"
    ) {
      return null;
    }
    return {
      version: CURSOR_USAGE_CACHE_VERSION,
      syncedAt: file.syncedAt,
      source: "cursor",
      events: file.events,
    };
  } catch {
    return null;
  }
}

/** Removes the cache file; used when the account session is gone for good. */
export async function removeCursorUsageCache(cachePath: string): Promise<void> {
  await rm(cachePath, { force: true });
}
