import { STORAGE_KEY_PREFIX } from "./app-config.js";

export const AUTO_UPDATE_PREFERENCE_KEY = `${STORAGE_KEY_PREFIX}update.autoEnabled`;
export const DEFAULT_AUTO_UPDATE_ENABLED = true;

/**
 * Latest version whose "restart to install" prompt the user deferred. Mirrors
 * `src/lib/update-preferences.ts`; kept in the shared preference store so the
 * prompt does not reappear for the same version after a reload or restart.
 */
export const UPDATE_RESTART_DISMISSED_KEY = `${STORAGE_KEY_PREFIX}update.restartDismissed`;

/**
 * Optional proxy used for update checks/downloads only ("" = follow the
 * system proxy). Mirrors `src/lib/update-preferences.ts`; stored normalized
 * (http/https/socks5 URL, no credentials).
 */
export const UPDATE_PROXY_KEY = `${STORAGE_KEY_PREFIX}update.proxy`;

/** Whether the configured update proxy is active (default off). */
export const UPDATE_PROXY_ENABLED_KEY = `${STORAGE_KEY_PREFIX}update.proxyEnabled`;

/** Boolean preference reader: only explicit false/"false" means disabled. */
export function parseUpdateProxyEnabled(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value !== "false";
  return false;
}

export function parseAutoUpdateEnabled(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) !== false;
    } catch {
      return value.toLowerCase() !== "false";
    }
  }
  return DEFAULT_AUTO_UPDATE_ENABLED;
}
