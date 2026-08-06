/**
 * Compatibility catalog. The single source of truth for tool facts is now the
 * tool-registry (`src/lib/tool-registry/`). This module derives the legacy
 * `AI_TOOLS` / `AI_TOOL_IDS` projection from the registry so existing
 * consumers (detection, usage sources, skills scanner, onboarding) keep working
 * without per-file edits.
 *
 * `usageLogParsingFor` is NOT yet registry-derived: in M2 every config has
 * `usage.mode = "unsupported"` (real usage readers arrive in M4). Until then it
 * preserves the frozen baseline mapping so the Sources page does not regress.
 * M4-T4 switches it to `getUsagePlan()` / `capabilities.usage.mode`.
 *
 * Browser note: this module is imported by browser code today. It is safe in M2
 * because configs carry no reader keys, commands, or pricing. Before M4 adds
 * those, browser consumers are migrated to `public-manifest.generated.ts` and
 * this module becomes server-only.
 */
import { listTools } from "../tool-registry/registry.ts";

export interface AiTool {
  /** Stable lowercase-kebab identifier (used as the usage `source` id). */
  id: string;
  /** PRD display name (also used as the Skill / Market agent label). */
  nameZh: string;
  /**
   * HOME-relative probe paths (macOS first, Windows variant where known) used
   * to detect whether the tool is installed. Empty array when no path is
   * known - the tool then renders as "未安装".
   */
  detectRoots: readonly string[];
}

/**
 * Parser coverage is intentionally modelled separately from installation.
 * A supported parser may find no records, and an installed tool may have no
 * parser yet; neither condition changes the filesystem installation fact.
 */
export type UsageLogParsing = "native" | "adapter" | "unsupported";

// Frozen baseline parser mapping (see __baseline__/baseline.ts). Replaced by
// registry-derived capability in M4-T4.
const NATIVE_USAGE_PARSERS = new Set(["claude-code", "codex"]);
const ADAPTER_USAGE_PARSERS = new Set([
  "cursor",
  "gemini-cli",
  "opencode",
  "github-copilot",
  "kimi-code",
  "workbuddy",
  "grok",
  "roo-code",
]);

export function usageLogParsingFor(toolId: string): UsageLogParsing {
  if (NATIVE_USAGE_PARSERS.has(toolId)) return "native";
  if (ADAPTER_USAGE_PARSERS.has(toolId)) return "adapter";
  return "unsupported";
}

const REGISTRY_TOOLS = listTools().filter(
  (def) => def.catalogVisible !== false,
);

export const AI_TOOLS: readonly AiTool[] = REGISTRY_TOOLS.map((def) => ({
  id: def.id,
  nameZh: def.display.nameZh,
  detectRoots: def.detection.roots,
}));

/** Stable lowercase-kebab ids for the 27 visible catalog tools (legacy sources excluded). */
export const AI_TOOL_IDS: readonly string[] = AI_TOOLS.map((tool) => tool.id);
