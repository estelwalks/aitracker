/**
 * Compatibility catalog. The single source of truth for tool facts is the
 * tool-registry (`src/lib/tool-registry/`). This module derives the legacy
 * `AI_TOOLS` / `AI_TOOL_IDS` projection from the registry so existing
 * consumers (detection, usage sources, skills scanner, onboarding) keep working
 * without per-file edits.
 */
import {
  getUsagePlan,
  listTools,
  officialDownloadUrlFor,
  toolSurfaceFor,
  type ToolSurface,
} from "../tool-registry/registry.ts";

export type { ToolSurface } from "../tool-registry/registry.ts";

export interface AiTool {
  /** Stable lowercase-kebab identifier (used as the usage `source` id). */
  id: string;
  /**
   * Legacy field name retained for compatibility. Its value is always the
   * registry's primary `display.name`, never a hand-authored UI alias.
   */
  nameZh: string;
  /**
   * HOME-relative probe paths (macOS first, Windows variant where known) used
   * to detect whether the tool is installed. Empty array when no path is
   * known - the tool then renders as "not installed".
   */
  detectRoots: readonly string[];
  /** Registry-owned product surface label for browser-safe source cards. */
  toolSurface: ToolSurface;
  /** Verified official URL, or null when the registry has no safe link. */
  officialDownloadUrl: string | null;
}

/**
 * Parser coverage is intentionally modelled separately from installation.
 * A supported parser may find no records, and an installed tool may have no
 * parser yet; neither condition changes the filesystem installation fact.
 */
export type UsageLogParsing = "native" | "adapter" | "unsupported";

/**
 * Parser coverage derived from the registry's usage capability (P4-T1).
 * Note: workbuddy moves adapter -> native (its declared mode is native
 * `workbuddy-native`); the frozen baseline recorded the old catalog label.
 */
export function usageLogParsingFor(toolId: string): UsageLogParsing {
  const plan = getUsagePlan(toolId);
  if (!plan) return "unsupported";
  return plan.mode;
}

const REGISTRY_TOOLS = listTools().filter(
  (def) => def.catalogVisible !== false,
);

export const AI_TOOLS: readonly AiTool[] = REGISTRY_TOOLS.map((def) => ({
  id: def.id,
  nameZh: def.display.name,
  detectRoots: def.detection.roots,
  toolSurface: toolSurfaceFor(def.id),
  officialDownloadUrl: officialDownloadUrlFor(def.id),
}));

/** Stable lowercase-kebab ids for the 29 visible catalog tools (legacy sources excluded). */
export const AI_TOOL_IDS: readonly string[] = AI_TOOLS.map((tool) => tool.id);
