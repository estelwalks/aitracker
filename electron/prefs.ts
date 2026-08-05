import { readFileSync, renameSync, writeFileSync } from "node:fs";

export const PREFS_FILENAME = "trusttools-prefs.json";

/** Locale preference key inside `trusttools-prefs.json`. */
export const LOCALE_PREF_KEY = "trusttools.locale";
/** Locale mode: "system" (default) or "manual". */
export const LOCALE_MODE_PREF_KEY = "trusttools.localeMode";
/** Display-currency preference key (manual mode only). */
export const CURRENCY_PREF_KEY = "trusttools.displayCurrency";
/** Display-currency mode: "system" (default) or "manual". */
export const CURRENCY_MODE_PREF_KEY = "trusttools.currencyMode";

/**
 * Read the preferences file as JSON. Missing or corrupt files yield `{}` —
 * preferences are best-effort and must never crash startup.
 */
export function readPrefs(prefsPath: string): Record<string, unknown> {
  try {
    const raw = readFileSync(prefsPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parsed != null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Persist preferences atomically (temp file + rename) so a crash mid-write
 * never corrupts the store.
 */
export function writePrefs(
  prefsPath: string,
  prefs: Record<string, unknown>,
): void {
  const tmp = `${prefsPath}.tmp.${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(prefs, null, 2), "utf8");
  renameSync(tmp, prefsPath);
}
