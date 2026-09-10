import type {
  SecurityScanHistoryEntry,
  SecuritySkillTarget,
} from "./contracts.js";

/**
 * Global-slot key mirror of `DESKTOP_SECURITY_SCANNER_GLOBAL_KEY` in
 * `src/modules/security-assessment/overview.server.ts`. Electron main writes
 * the scanner into this slot so the same-process SSR/server bundle (packaged
 * local web server) can resolve the canonical security overview without the
 * renderer round-trip; `desktop-scanner-seam.test.ts` pins both copies equal.
 */
export const DESKTOP_SECURITY_SCANNER_GLOBAL_KEY =
  "__aitracker_desktop_security_scanner_v1__";

/** Structural subset actually consumed by the server overview resolver. */
export interface DesktopSecurityScannerHandle {
  listSkills(): Promise<readonly SecuritySkillTarget[]>;
  history(): Promise<readonly SecurityScanHistoryEntry[]>;
}

/**
 * Registers the main-process scanner for same-process server loaders. Must
 * run after the scanner is constructed and before the local web server starts
 * accepting application requests (see main.ts).
 */
export function registerDesktopSecurityScanner(
  handle: DesktopSecurityScannerHandle,
): void {
  (globalThis as Record<string, unknown>)[DESKTOP_SECURITY_SCANNER_GLOBAL_KEY] =
    handle;
}
