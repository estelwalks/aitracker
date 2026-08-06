/**
 * Reader contracts (docs §6.2): controlled parser implementations stay in
 * TypeScript - JSON definitions only reference them by stable key. A factory
 * maps a validated key to its implementation; unknown keys are rejected at
 * build time by the registry validator.
 *
 * The actual parsing implementations live in the feature modules
 * (local-usage/claude-context.ts, codex-context.ts, adapters/*); this registry
 * binds the declared reader keys to those implementations so config and code
 * cannot drift.
 */
import {
  BUILTIN_USAGE_READERS,
  BUILTIN_SESSION_READERS,
  BUILTIN_CONTEXT_READERS,
} from "../validate.ts";

export type { UsageReaderKey, SessionReaderKey } from "../contracts.ts";

/** Registered reader-key sets (single source for validation + factories). */
export const REGISTERED_USAGE_READERS: ReadonlySet<string> =
  BUILTIN_USAGE_READERS;
export const REGISTERED_SESSION_READERS: ReadonlySet<string> =
  BUILTIN_SESSION_READERS;
export const REGISTERED_CONTEXT_READERS: ReadonlySet<string> =
  BUILTIN_CONTEXT_READERS;

export function isKnownUsageReader(key: string): boolean {
  return REGISTERED_USAGE_READERS.has(key);
}

export function isKnownSessionReader(key: string): boolean {
  return REGISTERED_SESSION_READERS.has(key);
}

export function isKnownContextReader(key: string): boolean {
  return REGISTERED_CONTEXT_READERS.has(key);
}
