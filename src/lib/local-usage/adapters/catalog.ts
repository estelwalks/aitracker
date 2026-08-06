import type { UsageAdapterContract, UsageFieldMapping } from "./types.ts";
import {
  getGenericReaderDefaults,
  listTools,
} from "../../tool-registry/registry.ts";

/**
 * Generic-reader defaults (moved to _shared/generic-reader-defaults.json,
 * P4-T3): the loader already fills them on every compiled definition; these
 * are null-safe fallbacks only.
 */
const genericDefaults = getGenericReaderDefaults();

/**
 * Built-in usage adapters, derived from the tool-registry: one entry per tool
 * (including `catalogVisible=false` legacy sources aipy/cline) with a
 * non-unsupported `usage` capability. The scanner still dispatches native
 * readers (claude-code/codex/workbuddy) via hardcoded calls; this catalog feeds
 * the generic adapter pipeline and the source-id universe.
 */
const REGISTRY_USAGE_ADAPTERS: UsageAdapterContract[] = listTools()
  .filter(
    (def) =>
      def.capabilities.usage.mode !== "unsupported" &&
      def.capabilities.usage.paths &&
      def.capabilities.usage.paths.length > 0,
  )
  .map((def) => {
    const usage = def.capabilities.usage;
    const entry: UsageAdapterContract = {
      source: def.id,
      paths: [...usage.paths!],
      // The loader fills these on every compiled definition; the shared-pack
      // fallback only guards a null policy getter (never in practice).
      mapping: (usage.mapping ??
        genericDefaults!.defaultMapping) as UsageFieldMapping,
      maxFileSizeBytes:
        usage.maxFileSizeBytes ?? genericDefaults!.defaultMaxFileSizeBytes,
      kind: "builtin",
    };
    if (usage.query) entry.query = usage.query;
    return entry;
  });

export const BUILTIN_USAGE_ADAPTERS: UsageAdapterContract[] = [
  ...REGISTRY_USAGE_ADAPTERS,
];

export const GENERIC_BUILTIN_USAGE_ADAPTERS = BUILTIN_USAGE_ADAPTERS.filter(
  (adapter) => adapter.source !== "claude-code" && adapter.source !== "codex",
);
