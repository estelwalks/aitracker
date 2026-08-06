/**
 * Reader-key dispatch (P4-T3): maps a validated UsageReaderKey to its parsing
 * implementation. The implementations themselves stay in the feature modules
 * (local-usage/adapters/*, claude-context.ts, codex-context.ts) - this module
 * only declares the key -> module binding so config and code cannot drift.
 *
 * Parsing dispatch happens inside the scanner per reader family; the factory
 * below is the controlled entry point for generic readers.
 */
import type { UsageFormat, UsageReaderKey } from "../contracts.ts";

export interface GenericReaderSpec {
  format: UsageFormat;
  /** JSON/JSONL record selector candidates (data, from the shared pack). */
  mapping: Record<string, string[]>;
  maxFileSizeBytes: number;
}

/**
 * Classify a reader key into the generic family it dispatches to. Native
 * readers (claude/codex/workbuddy) are dispatched by their own parser paths.
 */
export function genericReaderSpecFor(
  key: UsageReaderKey,
  defaults: { mapping: Record<string, string[]>; maxFileSizeBytes: number },
): { kind: "generic"; spec: GenericReaderSpec } | { kind: "native" } {
  if (key === "generic-json") {
    return {
      kind: "generic",
      spec: { format: "json", ...defaults },
    };
  }
  if (key === "generic-jsonl") {
    return {
      kind: "generic",
      spec: { format: "jsonl", ...defaults },
    };
  }
  if (key === "generic-sqlite") {
    return {
      kind: "generic",
      spec: { format: "sqlite", ...defaults },
    };
  }
  return { kind: "native" };
}
