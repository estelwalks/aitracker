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
 * Proxy schemes the update channel may dial, mirrored from
 * `electron/update-proxy.ts`.
 */
const ALLOWED_UPDATE_PROXY_SCHEMES = new Set([
  "http:",
  "https:",
  "socks4:",
  "socks5:",
]);
const UPDATE_PROXY_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//u;

/**
 * Renderer-side mirror of `electron/update-proxy.ts#normalizeUpdateProxy`, used
 * only to tell "the address is unusable" apart from "the save failed" in the
 * Settings dialog. The Electron main process stays authoritative: it
 * normalizes every write again before persisting. MUST stay in sync with the
 * Electron implementation (see `electron/update-proxy.test.ts`).
 */
export function normalizeUpdateProxyInput(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "";
  const candidate = UPDATE_PROXY_SCHEME_PATTERN.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new TypeError("invalid proxy URL");
  }
  if (!ALLOWED_UPDATE_PROXY_SCHEMES.has(url.protocol)) {
    throw new TypeError(
      `unsupported proxy scheme: ${url.protocol.slice(0, -1)}`,
    );
  }
  if (url.username || url.password) {
    throw new TypeError("proxy credentials are not supported");
  }
  if (
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search !== "" ||
    url.hash !== "" ||
    url.hostname.length === 0
  ) {
    throw new TypeError("proxy must be a bare host:port URL");
  }
  return `${url.protocol}//${url.host}`;
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
