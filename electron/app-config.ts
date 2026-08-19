/**
 * Electron-side mirror of the canonical config in `src/lib/app-config.ts`.
 *
 * The tsconfig boundary (`rootDir: "electron"` vs `src/`) prevents a safe
 * cross-import, so this file keeps the subset Electron needs as literal
 * duplicates. `scripts/check-app-config-sync.mjs` (part of `check:i18n`)
 * asserts this mirror is a textually equal, strict subset of the canonical
 * module — change values there first, then here.
 *
 * See `src/lib/app-config.ts` for the compat-sensitivity notes: values
 * marked [compat] must not change without a migration plan.
 */
export const APP_NAME = "AITracker";
export const APP_DATA_DIR = ".trusttools";
export const STORAGE_KEY_PREFIX = "trusttools.";
export const COOKIE_TOKEN_NAME = "trusttools_token";
export const SECURITY_CSRF_HEADER = "x-trusttools-csrf";
export const DESKTOP_GLOBAL = "trusttoolsDesktop";

export const ENV = {
  DEV_URL: "TRUSTTOOLS_DEV_URL",
  DESKTOP_BROKER_TOKEN: "TRUSTTOOLS_DESKTOP_BROKER_TOKEN",
  USAGE_HOME: "TRUSTTOOLS_USAGE_HOME",
} as const;
