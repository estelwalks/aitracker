import { useCallback, useEffect, useState } from "react";

// P6-T6-01 (fix): the server-fn value import is loaded dynamically so this
// browser-safe module never statically reaches the `.server` module; the
// type-only import is erased at compile time.
import type { VersionCheckResult } from "./version-check.server";

/**
 * FR-033 client side: trigger a silent update check on mount, cache the result
 * in the IPC prefs channel (so the sidebar red dot survives Electron restarts
 * on a random port), and expose `dismissed` so visiting the About page clears
 * the red dot.
 *
 * The check is silent: any failure leaves `hasUpdate=false`.
 */

import { APP_VERSION, STORAGE_KEY_PREFIX } from "./app-config";
import {
  listPreferences,
  setPreference,
  type PreferenceValue,
} from "./preferences/client.ts";

const PREF_HAS_UPDATE = `${STORAGE_KEY_PREFIX}update.hasUpdate`;
const PREF_LATEST = `${STORAGE_KEY_PREFIX}update.latestVersion`;
const PREF_RELEASE_DATE = `${STORAGE_KEY_PREFIX}update.releaseDate`;
const PREF_CHANGELOG = `${STORAGE_KEY_PREFIX}update.changelog`;
const PREF_RELEASE_URL = `${STORAGE_KEY_PREFIX}update.releaseUrl`;
const PREF_DOWNLOAD_URL = `${STORAGE_KEY_PREFIX}update.downloadUrl`;
const PREF_ASSET_NAME = `${STORAGE_KEY_PREFIX}update.assetName`;
const PREF_DISMISSED_LATEST = `${STORAGE_KEY_PREFIX}update.dismissedLatest`;
const PREF_CHECKED_AT = `${STORAGE_KEY_PREFIX}update.checkedAt`;
const PREF_CURRENT = `${STORAGE_KEY_PREFIX}update.currentVersion`;
const PREF_STATUS = `${STORAGE_KEY_PREFIX}update.status`;
export const VERSION_CHECK_TTL_MS = 24 * 60 * 60 * 1_000;

export interface UpdateState {
  hasUpdate: boolean;
  result: VersionCheckResult | null;
  loading: boolean;
  dismiss: () => void;
  refresh: () => Promise<void>;
}

function stringValue(
  values: Record<string, PreferenceValue>,
  key: string,
): string | null {
  return typeof values[key] === "string" ? values[key] : null;
}

export function useVersionCheck(autoCheckEnabled = true): UpdateState {
  const [result, setResult] = useState<VersionCheckResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [persisted, setPersisted] = useState<Record<string, PreferenceValue>>(
    {},
  );

  const runCheck = useCallback(async (forceRefresh = true) => {
    setLoading(true);
    try {
      if (!forceRefresh) {
        const values = await listPreferences();
        setPersisted(values);
        const cached = readCachedVersionResult(
          (key) => stringValue(values, key),
          Date.now(),
        );
        if (cached) {
          setResult(cached);
          return;
        }
      }
      const { checkForUpdates } = await import("./version-check.server");
      const next = await checkForUpdates();
      setResult(next);
      const hasUpdate = next.status === "newer";
      const payload: Record<string, string> = {
        [PREF_HAS_UPDATE]: JSON.stringify(hasUpdate),
        [PREF_LATEST]: next.latestVersion ?? "",
        [PREF_RELEASE_DATE]: next.releaseDate ?? "",
        [PREF_CHANGELOG]: next.changelog ?? "",
        [PREF_RELEASE_URL]: next.releaseUrl ?? "",
        [PREF_DOWNLOAD_URL]: next.downloadUrl ?? "",
        [PREF_ASSET_NAME]: next.assetName ?? "",
        [PREF_CHECKED_AT]: next.checkedAt,
        [PREF_CURRENT]: next.currentVersion,
        [PREF_STATUS]: next.status,
      };
      await Promise.all(
        Object.entries(payload).map(([key, value]) =>
          setPreference(key, value),
        ),
      );
      setPersisted((current) => ({ ...current, ...payload }));
    } catch {
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!autoCheckEnabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await runCheck(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [autoCheckEnabled, runCheck]);

  const dismiss = () => {
    const latest = result?.latestVersion ?? "";
    setPersisted((current) => ({
      ...current,
      [PREF_DISMISSED_LATEST]: latest,
    }));
    void setPreference(PREF_DISMISSED_LATEST, latest);
  };

  const persistedHasUpdate = stringValue(persisted, PREF_HAS_UPDATE) === "true";
  const dismissedLatest = stringValue(persisted, PREF_DISMISSED_LATEST) ?? "";
  const latestVersion =
    result?.latestVersion ?? stringValue(persisted, PREF_LATEST);
  const hasUpdate =
    autoCheckEnabled &&
    persistedHasUpdate &&
    (latestVersion == null || latestVersion !== dismissedLatest);

  return {
    hasUpdate,
    result,
    loading,
    dismiss,
    refresh: () => runCheck(true),
  };
}

/** Rehydrates a complete, version-matched update result for the mount fast path. */
export function readCachedVersionResult(
  getItem: (key: string) => string | null,
  now: number,
): VersionCheckResult | null {
  const checkedAt = getItem(PREF_CHECKED_AT);
  const currentVersion = getItem(PREF_CURRENT);
  const latestVersion = getItem(PREF_LATEST);
  const status = getItem(PREF_STATUS);
  const checkedAtMs = checkedAt == null ? Number.NaN : Date.parse(checkedAt);
  const ageMs = now - checkedAtMs;
  if (
    currentVersion !== APP_VERSION ||
    checkedAt == null ||
    (status !== "newer" && status !== "current" && status !== "unknown") ||
    (status !== "unknown" && !latestVersion) ||
    !Number.isFinite(checkedAtMs) ||
    ageMs < 0 ||
    ageMs > VERSION_CHECK_TTL_MS
  ) {
    return null;
  }
  return {
    status,
    currentVersion,
    latestVersion: status === "unknown" ? null : latestVersion,
    releaseDate:
      status === "unknown" ? null : getItem(PREF_RELEASE_DATE) || null,
    changelog: status === "unknown" ? null : getItem(PREF_CHANGELOG) || null,
    releaseUrl: status === "unknown" ? null : getItem(PREF_RELEASE_URL) || null,
    downloadUrl:
      status === "unknown" ? null : getItem(PREF_DOWNLOAD_URL) || null,
    assetName: status === "unknown" ? null : getItem(PREF_ASSET_NAME) || null,
    checkedAt,
  };
}
