const CHUNK_ERROR_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /dynamically imported module/i,
  /importing a module script failed/i,
  /loading chunk [\w-]+ failed/i,
  /chunkloaderror/i,
];

export const CHUNK_RELOAD_QUERY_PARAM = "_chunk_reload";

export interface ChunkRecoveryBrowser {
  readonly sessionStorage: Pick<Storage, "getItem" | "setItem">;
  readonly location: {
    readonly href: string;
    readonly pathname: string;
    replace(href: string): void;
  };
}

function chunkReloadStorageKey(pathname: string): string {
  return `tt:chunk-reload:${pathname}`;
}

function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object") return "";
  const value = error as { message?: unknown; cause?: unknown };
  const message = typeof value.message === "string" ? value.message : "";
  const cause = value.cause ? errorText(value.cause) : "";
  return `${message} ${cause}`.trim();
}

export function isChunkLoadError(error: unknown): boolean {
  const text = errorText(error);
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

export function claimChunkReload(
  storage: Pick<Storage, "getItem" | "setItem">,
  pathname: string,
): boolean {
  const key = chunkReloadStorageKey(pathname);
  try {
    if (storage.getItem(key) === "1") return false;
    storage.setItem(key, "1");
    return true;
  } catch {
    // Private browsing or blocked storage must not prevent the normal error
    // boundary from rendering its manual retry action.
    return false;
  }
}

/**
 * A cache-busted navigation successfully reached the new app shell. Allow a
 * later deployment to recover once again instead of requiring users to clear
 * browser storage after the first recovered chunk error.
 */
export function clearChunkReloadClaim(
  storage: Pick<Storage, "removeItem">,
  pathname: string,
): void {
  try {
    storage.removeItem(chunkReloadStorageKey(pathname));
  } catch {
    // Storage can be unavailable in private/locked-down browser contexts.
  }
}

export function addChunkReloadNonce(href: string, nonce: number): string {
  const url = new URL(href);
  url.searchParams.set(CHUNK_RELOAD_QUERY_PARAM, String(nonce));
  return url.toString();
}

/**
 * Remove the one-time cache-busting parameter after the new shell has mounted.
 * Returns `null` when this page load was not a chunk recovery.
 */
export function completeChunkRecovery(
  storage: Pick<Storage, "removeItem">,
  href: string,
): string | null {
  const url = new URL(href);
  if (!url.searchParams.has(CHUNK_RELOAD_QUERY_PARAM)) return null;

  clearChunkReloadClaim(storage, url.pathname);
  url.searchParams.delete(CHUNK_RELOAD_QUERY_PARAM);
  return url.toString();
}

/** Recover when Vite detects that a preloaded lazy chunk belongs to an older deployment. */
export function recoverFromVitePreloadError(
  browser: ChunkRecoveryBrowser,
  event: Pick<Event, "preventDefault">,
): void {
  event.preventDefault();
  if (!claimChunkReload(browser.sessionStorage, browser.location.pathname)) {
    return;
  }
  browser.location.replace(
    addChunkReloadNonce(browser.location.href, Date.now()),
  );
}
