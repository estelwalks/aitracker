import { useEffect, useRef, useState } from "react";
import { DEFAULT_SETTINGS, parseSettings, type AppSettings } from "./model.ts";
export { DEFAULT_SETTINGS, parseSettings, type AppSettings } from "./model.ts";

import { STORAGE_KEY_PREFIX } from "../app-config";

const STORAGE_KEY = `${STORAGE_KEY_PREFIX}settings.v1`;

async function loadSettingsFromPlatform(): Promise<Record<string, unknown>> {
  const api = (
    window as {
      desktopApi?: {
        getPreferences(): Promise<Record<string, unknown>>;
      };
    }
  ).desktopApi;
  if (api) {
    try {
      return await api.getPreferences();
    } catch {
      // IPC unavailable; fall through
    }
  }
  return {};
}

async function saveSettingToPlatform(
  key: string,
  value: string,
): Promise<void> {
  const api = (
    window as {
      desktopApi?: {
        setPreference(key: string, value: unknown): Promise<void>;
      };
    }
  ).desktopApi;
  if (api) {
    try {
      await api.setPreference(key, value);
    } catch {
      // IPC unavailable; fall through to localStorage mirror
    }
  }
}

export function useAppSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const lastSavedRef = useRef<string>("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      let raw: string | null = null;
      try {
        const prefs = await loadSettingsFromPlatform();
        if (prefs && typeof prefs[STORAGE_KEY] === "string") {
          raw = prefs[STORAGE_KEY] as string;
        }
      } catch {
        // fall through to localStorage
      }
      if (raw === null) {
        try {
          raw = window.localStorage.getItem(STORAGE_KEY);
        } catch {
          // localStorage not available
        }
      }
      if (cancelled) return;
      const parsed = parseSettings(raw);
      setSettings(parsed);
      lastSavedRef.current = JSON.stringify(parsed);
      setLoaded(true);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const serialized = JSON.stringify(settings);
    if (serialized === lastSavedRef.current) return;
    lastSavedRef.current = serialized;

    // Persist to IPC-backed filesystem when available
    void saveSettingToPlatform(STORAGE_KEY, serialized);

    // Always mirror to localStorage for browser dev mode
    try {
      window.localStorage.setItem(STORAGE_KEY, serialized);
    } catch {
      // localStorage not available
    }
  }, [loaded, settings]);

  return { settings, setSettings, loaded };
}
