import { useEffect, useState } from "react";

import { checkForUpdates } from "./version-check.server";
import type { VersionCheckResult } from "./version-check.server";

/**
 * FR-033 client side: trigger a silent update check on mount, cache the result
 * in the IPC prefs channel (so the sidebar red dot survives Electron restarts
 * on a random port), and expose `dismissed` so visiting the About page clears
 * the red dot.
 *
 * The check is silent: any failure leaves `hasUpdate=false`.
 */

import { STORAGE_KEY_PREFIX } from "./app-config";

const PREF_HAS_UPDATE = `${STORAGE_KEY_PREFIX}update.hasUpdate`;
const PREF_LATEST = `${STORAGE_KEY_PREFIX}update.latestVersion`;
const PREF_CHANGELOG = `${STORAGE_KEY_PREFIX}update.changelog`;
const PREF_RELEASE_URL = `${STORAGE_KEY_PREFIX}update.releaseUrl`;
const PREF_DISMISSED_LATEST = `${STORAGE_KEY_PREFIX}update.dismissedLatest`;
const PREF_CHECKED_AT = `${STORAGE_KEY_PREFIX}update.checkedAt`;

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

  const runCheck = async () => {
    setLoading(true);
    try {
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
      await runCheck();
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
    refresh: runCheck,
  };
}
