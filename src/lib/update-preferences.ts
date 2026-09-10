import { STORAGE_KEY_PREFIX } from "./app-config";

/** Persisted preference controlling background update checks and downloads. */
export const AUTO_UPDATE_PREFERENCE_KEY = `${STORAGE_KEY_PREFIX}update.autoEnabled`;
export const DEFAULT_AUTO_UPDATE_ENABLED = true;

/**
 * Latest version whose "restart to install" prompt the user deferred. Kept in
 * the shared preference store so the prompt does not reappear for the same
 * version after a window reload or app restart.
 */
export const UPDATE_RESTART_DISMISSED_KEY = `${STORAGE_KEY_PREFIX}update.restartDismissed`;

/**
 * Optional proxy used for update checks/downloads only ("" = follow the
 * system proxy). Persisted normalized (http/https/socks5 URL, no credentials).
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
