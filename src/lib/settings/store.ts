import { useEffect, useRef, useState } from "react";
import { DEFAULT_SETTINGS, parseSettings, type AppSettings } from "./model.ts";
export { DEFAULT_SETTINGS, parseSettings, type AppSettings } from "./model.ts";

import { STORAGE_KEY_PREFIX } from "../app-config";
import { getPreference, setPreference } from "../preferences/client.ts";

const STORAGE_KEY = `${STORAGE_KEY_PREFIX}settings.v1`;

export function useAppSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const lastSavedRef = useRef<string>("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const stored = await getPreference(STORAGE_KEY);
      const raw = typeof stored === "string" ? stored : null;
      if (cancelled) return;
      const parsed = parseSettings(raw);
      setSettings(parsed);
      lastSavedRef.current = JSON.stringify(parsed);
      setLoaded(true);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const serialized = JSON.stringify(settings);
    if (serialized === lastSavedRef.current) return;
    lastSavedRef.current = serialized;

    void setPreference(STORAGE_KEY, serialized);
  }, [loaded, settings]);

  return { settings, setSettings, loaded };
}
