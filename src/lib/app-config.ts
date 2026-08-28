/**
 * Central application configuration — the single source of truth for the
 * product name and every runtime identifier derived from it.
 *
 * The product display name is independent from the runtime identifiers.
 * To rebrand, change `APP_NAME`; every other constant derives from `APP_ID`
 * and the renderer
 * must never hardcode a brand literal (enforced by
 * `scripts/check-app-config-sync.mjs` via the `check:i18n` chain).
 *
 * ⚠ COMPAT SENSITIVITY — the constants marked [compat] below hold VALUES
 * THAT MUST NOT CHANGE without a migration plan: existing installs store
 * real data under `~/.aitracker`, browsers hold `aitracker.*` keys, and
 * session IDs are hashes over the HMAC domain string. This round only
 * centralizes them. Constants marked [safe] may be changed freely. The
 * namespace/data-directory rebrand intentionally starts a new AITracker
 * namespace; data from the previous product namespace is not auto-migrated.
 *
 * Note: `electron/app-config.ts` mirrors the subset Electron needs (the
 * tsconfig boundary prevents a cross-import); `check-app-config-sync.mjs`
 * enforces that the mirror stays textually in sync.
 */
export const APP_NAME = "AITracker";
export const APP_ID = "aitracker";

/** Theme-aware browser favicons. [safe] */
export const APP_FAVICON_DARK_URL = "/favicon-dark.svg";
export const APP_FAVICON_LIGHT_URL = "/favicon.svg";

/** Theme-aware product marks used inside the application UI. [safe] */
export const APP_BRAND_ICON_DARK_URL = APP_FAVICON_DARK_URL;
export const APP_BRAND_ICON_LIGHT_URL = APP_FAVICON_LIGHT_URL;

/** Product version shown in the UI; bump together with package.json `version`. */
export const APP_VERSION = "1.0.0";
/** Release date shown on the About page. */
export const APP_RELEASE_DATE = "2026-08-03";
/** Source repository link shown on the About page. */
export const APP_REPO_URL = "https://github.com/estelwalks/aitracker";

/** Local data root directory name under the user's home (`~/.aitracker`). [compat: user data] */
export const APP_DATA_DIR = `.${APP_ID}`;
/** Namespace for SQLite-backed application preference keys (`aitracker.*`). */
export const STORAGE_KEY_PREFIX = `${APP_ID}.`;
/** Capability-token cookie name in the local web server. [safe] */
export const COOKIE_TOKEN_NAME = `${APP_ID}_token`;
/** Same-origin mutation header for the browser companion API. [safe] */
export const SECURITY_CSRF_HEADER = `x-${APP_ID}-csrf`;
/** HMAC domain-separation string for local-usage session IDs. [compat: changing orphans every existing session ID] */
export const SESSION_HMAC_DOMAIN = `${APP_ID}-local-usage-session-v1`;
/** Downloaded export file prefix (`aitracker_export_<stamp>.csv`). [safe] */
export const EXPORT_FILENAME_PREFIX = `${APP_ID}_export_`;
/** Token poster image file prefix. [safe] */
export const POSTER_FILENAME_PREFIX = `${APP_ID}-token-`;
/** Skill market API base URL. [compat: live backend endpoint] */
export const MARKET_API_BASE = "https://ai.trusttools.cn/api";
/** Sandbox temp-dir prefix for tests. [safe — neutral on purpose] */
export const TEST_TMP_PREFIX = "aitracker-";
/** Name of the global object exposed by the Electron preload bridge. [safe — rebuilt per launch] */
export const DESKTOP_GLOBAL = `${APP_ID}Desktop`;

/**
 * Environment variable names. [compat: external contract — CI, scripts and
 * docs reference these; renaming breaks outside callers]
 */
export const ENV = {
  RUNTIME: `${APP_ID.toUpperCase()}_RUNTIME`,
  ENABLE_BACKGROUND_TASKS: `${APP_ID.toUpperCase()}_ENABLE_BACKGROUND_TASKS`,
  DEV_URL: `${APP_ID.toUpperCase()}_DEV_URL`,
  DEV_HOST: `${APP_ID.toUpperCase()}_DEV_HOST`,
  DEV_PORT: `${APP_ID.toUpperCase()}_DEV_PORT`,
  DESKTOP_BROKER_TOKEN: `${APP_ID.toUpperCase()}_DESKTOP_BROKER_TOKEN`,
  USAGE_HOME: `${APP_ID.toUpperCase()}_USAGE_HOME`,
  HOME: `${APP_ID.toUpperCase()}_HOME`,
  RELEASE_OWNER: `${APP_ID.toUpperCase()}_RELEASE_OWNER`,
  RELEASE_REPO: `${APP_ID.toUpperCase()}_RELEASE_REPO`,
  /** Overrides the default daily ceiling for real-model distillation calls. */
  DISTILL_DAILY_QUOTA: `${APP_ID.toUpperCase()}_DISTILL_DAILY_QUOTA`,
} as const;

/** Params to pass to every `t()`/`getMessage()` call whose key contains `{appName}`. */
export const brandParams = { appName: APP_NAME } as const;
