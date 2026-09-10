/**
 * Update-channel proxy support. Updates run over a dedicated Electron session
 * whose proxy is either the system default (`mode: "system"`) or an explicit
 * proxy the user configured in Settings (HTTP/HTTPS/SOCKS).
 *
 * Credentials inside the proxy URL are deliberately rejected: the value is
 * persisted in the shared preference store, and proxy passwords do not belong
 * there.
 */

const ALLOWED_PROXY_SCHEMES = new Set([
  "http:",
  "https:",
  "socks4:",
  "socks5:",
]);
const SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//u;

export interface SessionProxyConfig {
  readonly mode: "system" | "fixed_servers";
  readonly proxyRules?: string;
  readonly proxyBypassRules?: string;
}

/**
 * Normalize a user-supplied proxy value into the persisted form:
 * - empty/whitespace only -> "" (follow the system proxy)
 * - a bare host:port gets an `http://` scheme
 * - a full URL keeps its scheme when http/https/socks4/socks5
 * - paths, query strings, fragments and credentials are rejected
 *
 * Throws a TypeError for anything unusable.
 */
export function normalizeUpdateProxy(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "";
  const candidate = SCHEME_PATTERN.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new TypeError("invalid proxy URL");
  }
  if (!ALLOWED_PROXY_SCHEMES.has(url.protocol)) {
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

/** Electron `session.setProxy` payload for a normalized proxy value. */
export function updateProxyConfig(proxy: string): SessionProxyConfig {
  return proxy.length === 0
    ? { mode: "system" }
    : {
        mode: "fixed_servers",
        proxyRules: proxy,
        proxyBypassRules: "<local>",
      };
}
