/** Safe, path-free startup diagnostic codes for the desktop warmup boundary. */

export const STARTUP_FAILURE_CODE_HEADER = "x-aitracker-startup-failure-code";

const DATABASE_CODES = new Set([
  "access-denied",
  "already-open",
  "busy",
  "capability-mismatch",
  "corrupt",
  "integrity-check-failed",
  "io-failure",
  "journal-not-wal",
  "migration-checksum",
  "migration-reverted",
]);

/**
 * Finds a stable database error code through our small, known wrapper chain.
 * Raw messages and filesystem paths must never cross the desktop warmup HTTP
 * boundary, including through headers.
 */
export function startupFailureCode(error: unknown): string {
  let current = error;
  const visited = new Set<object>();

  for (let depth = 0; depth < 8; depth += 1) {
    if (current == null || typeof current !== "object") break;
    if (visited.has(current)) break;
    visited.add(current);

    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && DATABASE_CODES.has(code)) {
      return `database.${code}`;
    }
    current = (current as { cause?: unknown }).cause;
  }

  return "startup.unavailable";
}
