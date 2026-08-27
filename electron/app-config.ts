/**
 * Electron-side mirror of the canonical config in `src/lib/app-config.ts`.
 *
 * The tsconfig boundary (`rootDir: "electron"` vs `src/`) prevents a safe
 * cross-import, so this file keeps the subset Electron needs as literal
 * duplicates. `scripts/check-app-config-sync.mjs` (part of `check:i18n`)
 * asserts this mirror is a textually equal, strict subset of the canonical
 * module — change values there first, then here.
 *
 * See `src/lib/app-config.ts` for the compatibility notes and the intentional
 * AITracker namespace/data-directory boundary.
 */
export const APP_NAME = "AITracker";
export const APP_DATA_DIR = ".aitracker";
export const STORAGE_KEY_PREFIX = "aitracker.";
export const COOKIE_TOKEN_NAME = "aitracker_token";
export const SECURITY_CSRF_HEADER = "x-aitracker-csrf";
export const DESKTOP_GLOBAL = "aitrackerDesktop";

export const ENV = {
  DEV_URL: "AITRACKER_DEV_URL",
  DESKTOP_BROKER_TOKEN: "AITRACKER_DESKTOP_BROKER_TOKEN",
  USAGE_HOME: "AITRACKER_USAGE_HOME",
} as const;
