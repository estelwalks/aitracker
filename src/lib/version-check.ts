import { useEffect, useState } from "react";

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

const PREF_HAS_UPDATE = `${STORAGE_KEY_PREFIX}update.hasUpdate`;
const PREF_LATEST = `${STORAGE_KEY_PREFIX}update.latestVersion`;
const PREF_CHANGELOG = `${STORAGE_KEY_PREFIX}update.changelog`;
const PREF_RELEASE_URL = `${STORAGE_KEY_PREFIX}update.releaseUrl`;
const PREF_DISMISSED_LATEST = `${STORAGE_KEY_PREFIX}update.dismissedLatest`;
const PREF_CHECKED_AT = `${STORAGE_KEY_PREFIX}update.checkedAt`;
const PREF_CURRENT = `${STORAGE_KEY_PREFIX}update.currentVersion`;
const PREF_STATUS = `${STORAGE_KEY_PREFIX}update.status`;
export const VERSION_CHECK_TTL_MS = 24 * 60 * 60 * 1_000;

interface DesktopPrefsApi {
  getPreferences(): Promise<Record<string, unknown>>;
  setPreference(key: string, value: unknown): Promise<void>;
}

function desktopApi(): DesktopPrefsApi | undefined {
  return (window as { desktopApi?: DesktopPrefsApi }).desktopApi;
}

export interface UpdateState {
  hasUpdate: boolean;
  result: VersionCheckResult | null;
  loading: boolean;
  dismiss: () => void;
  refresh: () => Promise<void>;
}

function readString(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Seed localStorage from the IPC prefs file on mount so the synchronous red-dot
 * render sees the persisted value even after an Electron restart.
 */
async function seedFromPlatform(): Promise<void> {
  const api = desktopApi();
  if (!api) return;
  try {
    const prefs = await api.getPreferences();
    for (const key of [
      PREF_HAS_UPDATE,
      PREF_LATEST,
      PREF_CHANGELOG,
      PREF_RELEASE_URL,
      PREF_DISMISSED_LATEST,
      PREF_CHECKED_AT,
      PREF_CURRENT,
      PREF_STATUS,
    ]) {
      if (typeof prefs[key] === "string") {
        window.localStorage.setItem(key, prefs[key] as string);
      }
    }
  } catch {
    // IPC unavailable; keep existing localStorage values.
  }
}

export function useVersionCheck(): UpdateState {
  const [result, setResult] = useState<VersionCheckResult | null>(null);
  const [loading, setLoading] = useState(true);

  const runCheck = async (forceRefresh = true) => {
    setLoading(true);
    try {
      if (!forceRefresh) {
        const cached = readCachedVersionResult(
          (key) => readString(key),
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
      const api = desktopApi();
      const hasUpdate = next.status === "newer";
      const payload: Record<string, string> = {
        [PREF_HAS_UPDATE]: JSON.stringify(hasUpdate),
        [PREF_LATEST]: next.latestVersion ?? "",
        [PREF_CHANGELOG]: next.changelog ?? "",
        [PREF_RELEASE_URL]: next.releaseUrl ?? "",
        [PREF_CHECKED_AT]: next.checkedAt,
        [PREF_CURRENT]: next.currentVersion,
        [PREF_STATUS]: next.status,
      };
      for (const [key, value] of Object.entries(payload)) {
        try {
          window.localStorage.setItem(key, value);
        } catch {
          // ignore
        }
      }
      if (api) {
        for (const [key, value] of Object.entries(payload)) {
          void api.setPreference(key, value).catch(() => {});
        }
      }
    } catch {
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await seedFromPlatform();
      if (cancelled) return;
      await runCheck(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = () => {
    const latest = result?.latestVersion ?? "";
    try {
      window.localStorage.setItem(PREF_DISMISSED_LATEST, latest);
    } catch {
      // ignore
    }
    const api = desktopApi();
    if (api)
      void api.setPreference(PREF_DISMISSED_LATEST, latest).catch(() => {});
  };

  const persistedHasUpdate = readString(PREF_HAS_UPDATE) === "true";
  const dismissedLatest = readString(PREF_DISMISSED_LATEST) ?? "";
  const latestVersion = result?.latestVersion ?? readString(PREF_LATEST);
  const hasUpdate =
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
    changelog: status === "unknown" ? null : getItem(PREF_CHANGELOG) || null,
    releaseUrl: status === "unknown" ? null : getItem(PREF_RELEASE_URL) || null,
    checkedAt,
  };
}
