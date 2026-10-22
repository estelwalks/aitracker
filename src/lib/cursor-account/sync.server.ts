import { stat } from "node:fs/promises";

import type { PlatformOs } from "../tool-registry/registry.ts";
import { readCursorAccountSession } from "./auth.server.ts";
import {
  mergeCursorUsageRecords,
  readCursorUsageCache,
  writeCursorUsageCache,
} from "./cache.server.ts";
import {
  CURSOR_ACCOUNT_ERROR_CODES,
  CursorAccountError,
  fetchCursorUsageCsv,
  type CursorAccountErrorCode,
} from "./client.server.ts";
import {
  parseCursorUsageCsv,
  toCursorUsageCacheRecords,
  type CursorUsageCacheRecord,
} from "./csv.server.ts";
import {
  isCursorAccountInstalled,
  resolveCursorAccountPaths,
  type CursorAccountPaths,
} from "./paths.server.ts";

/**
 * Opt-in collector for Cursor's account-level token usage.
 *
 * Cursor keeps no local per-request usage log, so the only faithful source is
 * its own account API. This module performs the single outbound request and
 * writes a cache the offline scanner reads; it never participates in a local
 * scan and never persists the session token.
 */
export type CursorAccountSyncStatus =
  | "disabled"
  | "not-installed"
  | "not-signed-in"
  | "synced"
  | "failed"
  | "cancelled";

export interface CursorAccountSyncResult {
  readonly status: CursorAccountSyncStatus;
  readonly installed: boolean;
  readonly signedIn: boolean;
  readonly records: number;
  readonly cachedRecords: number;
  readonly truncated: boolean;
  readonly syncedAt: string | null;
  readonly errorCode: CursorAccountErrorCode | null;
}

export interface CursorAccountStatus {
  readonly installed: boolean;
  readonly signedIn: boolean;
  readonly cachePath: string;
  readonly syncedAt: string | null;
  readonly cachedRecords: number;
}

export interface CursorAccountSyncOptions {
  readonly homeDirectory: string;
  readonly platform?: PlatformOs;
  readonly env?: { readonly XDG_CONFIG_HOME?: string | undefined };
  /** Feature switch (the user's opt-in). A disabled collector never connects. */
  readonly enabled: boolean;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly signal?: AbortSignal;
  /** Test seam: inject resolved paths, the session, or the fetcher. */
  readonly paths?: CursorAccountPaths;
  readonly readSession?: (
    paths: CursorAccountPaths,
  ) => Promise<{ cookie: string } | null>;
}

function resolvePaths(options: CursorAccountSyncOptions): CursorAccountPaths {
  return (
    options.paths ??
    resolveCursorAccountPaths({
      homeDirectory: options.homeDirectory,
      platform: options.platform,
      env: options.env,
    })
  );
}

/** Reads the current install/sign-in/cache state without any network access. */
export async function readCursorAccountStatus(options: {
  readonly homeDirectory: string;
  readonly platform?: PlatformOs;
  readonly env?: { readonly XDG_CONFIG_HOME?: string | undefined };
  readonly paths?: CursorAccountPaths;
}): Promise<CursorAccountStatus> {
  const paths = resolvePaths({ ...options, enabled: false });
  const installed = await isCursorAccountInstalled({ appDir: paths.appDir });
  const session = installed
    ? await readCursorAccountSession(paths).catch(() => null)
    : null;
  const cache = await readCursorUsageCache(paths.cachePath);
  return {
    installed,
    signedIn: session != null,
    cachePath: paths.cachePath,
    syncedAt: cache?.syncedAt ?? null,
    cachedRecords: cache?.events.length ?? 0,
  };
}

function result(
  status: CursorAccountSyncStatus,
  partial: Partial<CursorAccountSyncResult> = {},
): CursorAccountSyncResult {
  return {
    status,
    installed: partial.installed ?? false,
    signedIn: partial.signedIn ?? false,
    records: partial.records ?? 0,
    cachedRecords: partial.cachedRecords ?? 0,
    truncated: partial.truncated ?? false,
    syncedAt: partial.syncedAt ?? null,
    errorCode: partial.errorCode ?? null,
  };
}

/**
 * Fetches the account export and refreshes the cache.
 *
 * Every failure is classified and returned, never thrown: the scheduled task
 * and the manual "sync now" action both need a stable status to show, and a
 * missing Cursor install or an expired Cursor session is an expected state,
 * not a broken AITracker.
 */
export async function syncCursorAccountUsage(
  options: CursorAccountSyncOptions,
): Promise<CursorAccountSyncResult> {
  options.signal?.throwIfAborted();
  const paths = resolvePaths(options);
  const installed = await isCursorAccountInstalled({ appDir: paths.appDir });
  if (!installed) return result("not-installed");
  if (!options.enabled) return result("disabled", { installed: true });

  const readSession = options.readSession ?? readCursorAccountSession;
  const session = await readSession(paths).catch(() => null);
  if (session == null) {
    return result("not-signed-in", { installed: true });
  }
  options.signal?.throwIfAborted();

  let csv: string;
  try {
    csv = await fetchCursorUsageCsv({
      cookie: session.cookie,
      ...(options.fetchImpl == null ? {} : { fetchImpl: options.fetchImpl }),
    });
  } catch (error) {
    const errorCode: CursorAccountErrorCode =
      error instanceof CursorAccountError
        ? error.code
        : CURSOR_ACCOUNT_ERROR_CODES.requestFailed;
    return result("failed", { installed: true, signedIn: true, errorCode });
  }
  options.signal?.throwIfAborted();

  const incoming: CursorUsageCacheRecord[] = toCursorUsageCacheRecords(
    parseCursorUsageCsv(csv),
  );
  const previous = await readCursorUsageCache(paths.cachePath);
  const merged = mergeCursorUsageRecords(previous?.events ?? [], incoming);
  const syncedAt = new Date(options.now?.() ?? Date.now()).toISOString();
  const write = await writeCursorUsageCache(paths.cachePath, merged, syncedAt);
  return result("synced", {
    installed: true,
    signedIn: true,
    records: incoming.length,
    cachedRecords: write.written,
    // Do not hide a silent loss of history: the cache keeps only the newest
    // records because the scanner reads whole files.
    truncated: write.truncated,
    syncedAt,
  });
}

/** Whether the cache file exists right now (used by diagnostics/tests). */
export async function cursorAccountCacheExists(
  cachePath: string,
): Promise<boolean> {
  try {
    return (await stat(cachePath)).isFile();
  } catch {
    return false;
  }
}
