const CHUNK_ERROR_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /dynamically imported module/i,
  /importing a module script failed/i,
  /loading chunk [\w-]+ failed/i,
  /chunkloaderror/i,
];

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
  const key = `tt:chunk-reload:${pathname}`;
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

export function addChunkReloadNonce(href: string, nonce: number): string {
  const url = new URL(href);
  url.searchParams.set("_chunk_reload", String(nonce));
  return url.toString();
}
