import { STORAGE_KEY_PREFIX } from "./app-config.js";

/** Locale preference key in the SQLite app_preferences namespace. */
export const LOCALE_PREF_KEY = `${STORAGE_KEY_PREFIX}locale`;
/** Locale mode: "system" (default) or "manual". */
export const LOCALE_MODE_PREF_KEY = `${STORAGE_KEY_PREFIX}localeMode`;
/** Display-currency preference key (manual mode only). */
export const CURRENCY_PREF_KEY = `${STORAGE_KEY_PREFIX}displayCurrency`;
/** Display-currency mode: "system" (default) or "manual". */
export const CURRENCY_MODE_PREF_KEY = `${STORAGE_KEY_PREFIX}currencyMode`;
