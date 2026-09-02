import packageJson from "../../../package.json";

import { APP_NAME, APP_REPO_URL } from "../app-config.ts";

/**
 * Identifies every outbound request made by the application. Keep the version
 * sourced from package.json so releases cannot silently send a stale,
 * hard-coded application version.
 */
export function applicationUserAgent(
  appVersion: string = packageJson.version,
): string {
  return `${APP_NAME}/${appVersion} (Electron; +${APP_REPO_URL})`;
}

/**
 * Shared outbound HTTP adapter. It owns the application UA so individual
 * external integrations cannot accidentally omit or override it.
 */
export function fetchExternal(
  input: Parameters<typeof fetch>[0],
  init: RequestInit = {},
  fetcher: typeof fetch = fetch,
): ReturnType<typeof fetch> {
  const headers = new Headers(init.headers);
  headers.set("User-Agent", applicationUserAgent());
  // Keep the init shape compatible with the existing provider test seams and
  // custom fetch implementations while still normalizing case/duplicates.
  return fetcher(input, {
    ...init,
    headers: Object.fromEntries(headers.entries()),
  });
}
