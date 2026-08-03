import { useEffect, useRef, useState } from "react";

export interface TrustToolsSettings {
  launchAtLoginRequested: boolean;
  retentionDays: number;
  dataPath: string;
}

export const DEFAULT_SETTINGS: TrustToolsSettings = {
  launchAtLoginRequested: false,
  retentionDays: 90,
  dataPath: "~/",
};

const STORAGE_KEY = "trusttools.settings.v1";

export function parseSettings(raw: string | null): TrustToolsSettings {
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const value = JSON.parse(raw) as Partial<TrustToolsSettings>;
    const numberValue = (candidate: unknown, fallback: number) =>
      typeof candidate === "number" &&
      Number.isFinite(candidate) &&
      candidate >= 0
        ? candidate
        : fallback;
    return {
      ...DEFAULT_SETTINGS,
      launchAtLoginRequested:
        typeof value.launchAtLoginRequested === "boolean"
          ? value.launchAtLoginRequested
          : DEFAULT_SETTINGS.launchAtLoginRequested,
      retentionDays: numberValue(
        value.retentionDays,
        DEFAULT_SETTINGS.retentionDays,
      ),
      dataPath:
        typeof value.dataPath === "string" && value.dataPath.length > 0
          ? value.dataPath
          : DEFAULT_SETTINGS.dataPath,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

async function loadSettingsFromPlatform(): Promise<Record<string, unknown>> {
  const api = (
    window as {
      trustToolsDesktop?: {
        getPreferences(): Promise<Record<string, unknown>>;
      };
    }
  ).trustToolsDesktop;
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
      trustToolsDesktop?: {
        setPreference(key: string, value: unknown): Promise<void>;
      };
    }
  ).trustToolsDesktop;
  if (api) {
    try {
      await api.setPreference(key, value);
    } catch {
      // IPC unavailable; fall through to localStorage mirror
    }
  }
}

export function useTrustToolsSettings() {
  const [settings, setSettings] =
    useState<TrustToolsSettings>(DEFAULT_SETTINGS);
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
