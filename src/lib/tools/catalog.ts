/**
 * Single source of truth for the AI tools TrustTools V3.0 knows about.
 *
 * PRD v1.2 §1.4 / §7.1 defines a fixed list of 27 AI coding tools. Every other
 * module (local-usage sources, local-skills agents, local-market install
 * targets) must derive its tool/agent list from `AI_TOOLS` so the catalog is
 * the only place that needs editing when the supported set changes.
 */

export interface AiTool {
  /** Stable lowercase-kebab identifier (used as the usage `source` id). */
  id: string;
  /** PRD display name (also used as the Skill / Market agent label). */
  nameZh: string;
  /**
   * HOME-relative probe paths (macOS first, Windows variant where known) used
   * to detect whether the tool is installed. Empty array when no path is
   * known — the tool then renders as "未安装".
   */
  detectRoots: readonly string[];
}

/**
 * Parser coverage is intentionally modelled separately from installation.
 * A supported parser may find no records, and an installed tool may have no
 * parser yet; neither condition changes the filesystem installation fact.
 */
export type UsageLogParsing = "native" | "adapter" | "unsupported";

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

export const AI_TOOLS: readonly AiTool[] = [
  {
    id: "claude-code",
    nameZh: "Claude Code",
    detectRoots: [".claude", "Library/Application Support/Claude"],
  },
  {
    id: "codex",
    nameZh: "Codex CLI",
    detectRoots: [".codex"],
  },
  {
    id: "cursor",
    nameZh: "Cursor",
    detectRoots: ["Library/Application Support/Cursor", ".cursor"],
  },
  {
    id: "kiro",
    nameZh: "Kiro",
    detectRoots: [".kiro"],
  },
  {
    id: "gemini-cli",
    nameZh: "Gemini CLI",
    detectRoots: [".gemini"],
  },
  {
    id: "opencode",
    nameZh: "OpenCode",
    detectRoots: [".config/opencode", ".local/share/opencode"],
  },
  {
    id: "openclaw",
    nameZh: "OpenClaw",
    detectRoots: [".openclaw"],
  },
  {
    id: "every-code",
    nameZh: "Every Code",
    detectRoots: [".every-code"],
  },
  {
    id: "hermes",
    nameZh: "Hermes Agent",
    detectRoots: [".hermes"],
  },
  {
    id: "github-copilot",
    nameZh: "GitHub Copilot",
    detectRoots: [".config/github-copilot"],
  },
  {
    id: "kimi-code",
    nameZh: "Kimi Code",
    detectRoots: [".kimi"],
  },
  {
    id: "omp",
    nameZh: "oh-my-pi",
    detectRoots: [".omp", ".oh-my-pi"],
  },
  {
    id: "codebuddy",
    nameZh: "CodeBuddy",
    detectRoots: [".codebuddy"],
  },
  {
    id: "workbuddy",
    nameZh: "WorkBuddy",
    detectRoots: [".workbuddy"],
  },
  {
    id: "grok",
    nameZh: "Grok Build",
    detectRoots: [".grok"],
  },
  {
    id: "kilo-cli",
    nameZh: "Kilo CLI",
    detectRoots: [".kilo", ".local/share/kilo"],
  },
  {
    id: "kilocode",
    nameZh: "Kilo Code",
    detectRoots: [
      "Library/Application Support/Code/User/globalStorage/kilocode.kilo-code",
    ],
  },
  {
    id: "antigravity",
    nameZh: "Antigravity",
    detectRoots: [
      ".gemini/antigravity",
      "Library/Application Support/Antigravity",
    ],
  },
  {
    id: "pi",
    nameZh: "pi",
    detectRoots: [".pi"],
  },
  {
    id: "craft",
    nameZh: "Craft Agents",
    detectRoots: [".craft-agent"],
  },
  {
    id: "roo-code",
    nameZh: "Roo Code",
    detectRoots: [
      "Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline",
    ],
  },
  {
    id: "zed",
    nameZh: "Zed Agent",
    detectRoots: ["Library/Application Support/Zed", ".local/share/zed"],
  },
  {
    id: "goose",
    nameZh: "Goose",
    detectRoots: [".local/share/goose", ".goose"],
  },
  {
    id: "droid",
    nameZh: "Droid",
    detectRoots: [".factory"],
  },
  {
    id: "mimo",
    nameZh: "Mimo Code",
    detectRoots: [".local/share/mimocode"],
  },
  {
    id: "zcode",
    nameZh: "ZCode",
    detectRoots: [".zcode"],
  },
  {
    id: "anythingllm",
    nameZh: "AnythingLLM Desktop",
    detectRoots: ["Library/Application Support/anythingllm-desktop"],
  },
] as const;

/** Stable lowercase-kebab ids for all 27 tools, derived from `AI_TOOLS`. */
export const AI_TOOL_IDS: readonly string[] = AI_TOOLS.map((tool) => tool.id);
