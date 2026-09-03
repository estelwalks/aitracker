import { STORAGE_KEY_PREFIX } from "./app-config";

/** Persisted preference controlling background update checks and downloads. */
export const AUTO_UPDATE_PREFERENCE_KEY = `${STORAGE_KEY_PREFIX}update.autoEnabled`;
export const DEFAULT_AUTO_UPDATE_ENABLED = true;

/** Treat only an explicit false as disabled; missing/corrupt values stay on. */
export function parseAutoUpdateEnabled(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed === false ? false : true;
    } catch {
      return value.toLowerCase() !== "false";
    }
  }
  return DEFAULT_AUTO_UPDATE_ENABLED;
}
