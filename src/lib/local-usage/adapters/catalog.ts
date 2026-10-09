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
 * Built-in usage adapters, derived from the public tool-registry catalog: one
 * entry per visible tool with a non-unsupported `usage` capability. Hidden
 * definitions stay in the registry for future enablement, but are not scanned
 * or shown as local usage sources until their data contract is verified.
 */
const REGISTRY_USAGE_ADAPTERS: UsageAdapterContract[] = listTools()
  .filter(
    (def) =>
      def.capabilities.usage.mode !== "unsupported" &&
      def.catalogVisible !== false &&
      def.capabilities.usage.paths &&
      def.capabilities.usage.paths.length > 0,
  )
  .map((def) => {
    const usage = def.capabilities.usage;
    const entry: UsageAdapterContract = {
      source: def.id,
      reader: usage.reader!,
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
    if (usage.windowFilter) entry.windowFilter = usage.windowFilter;
    return entry;
  });

export const BUILTIN_USAGE_ADAPTERS: UsageAdapterContract[] = [
  ...REGISTRY_USAGE_ADAPTERS,
];

export const GENERIC_BUILTIN_USAGE_ADAPTERS = BUILTIN_USAGE_ADAPTERS.filter(
  (adapter) =>
    adapter.reader === "generic" || adapter.reader.startsWith("generic-"),
);
