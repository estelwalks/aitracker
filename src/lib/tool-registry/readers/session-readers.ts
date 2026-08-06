/**
 * Session reader-key dispatch (P1-3): maps a validated SessionReaderKey to its
 * scan implementation. The implementations stay in the feature module
 * (local-sessions/scanner.server.ts) - this module only binds keys to
 * implementations so config and code cannot drift.
 *
 * Registration is controlled: built-in keys (`BUILTIN_SESSION_READERS`) are
 * registered exactly once by the feature module; custom keys are open so a new
 * session tool can register its reader without touching this file or the
 * registry. Tests register fake readers and must reset them via
 * `__resetSessionReaders()` (custom registrations only; built-ins persist).
 */
import type { SessionReaderKey } from "../contracts.ts";
import { BUILTIN_SESSION_READERS } from "../validate.ts";

import type { SessionRecord } from "../../local-sessions/types.ts";

/**
 * Scans one session tool's data root. `root` is an absolute directory - for
 * the built-in readers the tool home directory (`~/.claude`, `~/.codex`,
 * `~/.grok`), from which the implementation derives its own sub-roots.
 */
export type SessionReader = (root: string) => Promise<SessionRecord[]>;

export interface SessionReaderDefinition {
  /** Controlled key declared in `capabilities.sessions.reader`. */
  key: SessionReaderKey;
  /** Parsing implementation; receives the resolved absolute scan root. */
  scan: SessionReader;
  /**
   * HOME-relative fallback roots (P1-3 legacy parity) used when the tool JSON
   * declares no `storage.dataRoots` for the sessions capability. The platform
   * path plan is authoritative when it yields paths; otherwise these keep the
   * pre-registry hardcoded behavior.
   */
  defaultRoots: readonly string[];
}

const builtinReaders = new Map<string, SessionReaderDefinition>();
const customReaders = new Map<string, SessionReaderDefinition>();

export function registerSessionReader(def: SessionReaderDefinition): void {
  const key = def.key;
  if (BUILTIN_SESSION_READERS.has(key)) {
    if (builtinReaders.has(key)) {
      throw new Error(`Built-in session reader "${key}" is already registered`);
    }
    builtinReaders.set(key, def);
    return;
  }
  if (customReaders.has(key)) {
    throw new Error(`Session reader "${key}" is already registered`);
  }
  customReaders.set(key, def);
}

export function getSessionReader(
  key: SessionReaderKey,
): SessionReaderDefinition | undefined {
  return builtinReaders.get(key) ?? customReaders.get(key);
}

/** Registered readers, built-ins first (diagnostics / tests). */
export function listSessionReaders(): readonly SessionReaderDefinition[] {
  return [...builtinReaders.values(), ...customReaders.values()];
}

/** Clear custom registrations only (test isolation); built-ins persist. */
export function __resetSessionReaders(): void {
  customReaders.clear();
}
