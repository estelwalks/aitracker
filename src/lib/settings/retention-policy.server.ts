import { readFile } from "node:fs/promises";

import { ENV, STORAGE_KEY_PREFIX } from "../app-config.ts";
import { DEFAULT_SETTINGS, parseSettings } from "./model.ts";

const SETTINGS_KEY = `${STORAGE_KEY_PREFIX}settings.v1`;

/** Reads the renderer's persisted settings through the Electron prefs file. */
export async function readCurrentRetentionDays(): Promise<number> {
  const path = process.env[ENV.PREFS_PATH]?.trim();
  if (!path) return DEFAULT_SETTINGS.retentionDays;
  try {
    const prefs = JSON.parse(await readFile(path, "utf8")) as Record<
      string,
      unknown
    >;
    const raw = prefs[SETTINGS_KEY];
    return parseSettings(typeof raw === "string" ? raw : null).retentionDays;
  } catch {
    return DEFAULT_SETTINGS.retentionDays;
  }
}
