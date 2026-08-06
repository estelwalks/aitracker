/**
 * Registry fingerprint (server-only). sha256 over the registry's canonical
 * source string. Embedded in usage-cache snapshots so a config change (path,
 * reader, command, or pricing-rule set) invalidates stale parse results.
 */
import { createHash } from "node:crypto";

import type { CompiledRegistry } from "./registry.ts";

export function computeRegistryFingerprint(registry: CompiledRegistry): string {
  return createHash("sha256").update(registry.canonicalSource).digest("hex");
}

/**
 * `toolRegistryVersion` (docs §8.1): sha256 over the full canonical JSON
 * (definitions + shared packs). Identical to the cache fingerprint; the name
 * mirrors the pricing registry's version concept.
 */
export function computeToolRegistryVersion(registry: CompiledRegistry): string {
  return computeRegistryFingerprint(registry);
}
