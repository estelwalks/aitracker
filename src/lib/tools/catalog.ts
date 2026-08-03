/**
 * Single source of truth for the AI tools AITracker V3.0 knows about.
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
  /**
   * HOME-relative skill directory (e.g. ".claude/skills"), or `null` when the
   * tool has no skills directory concept. Tools with a non-null suffix become
   * Skill / Market agents.
   */
  skillRootSuffix: string | null;
}

export const AI_TOOLS: readonly AiTool[] = [
  {
    id: "claude-code",
    nameZh: "Claude Code",
    detectRoots: [".claude", "Library/Application Support/Claude"],
    skillRootSuffix: ".claude/skills",
  },
  {
    id: "codex",
    nameZh: "Codex CLI",
    detectRoots: [".codex"],
    skillRootSuffix: ".codex/skills",
  },
  {
    id: "cursor",
    nameZh: "Cursor",
    detectRoots: ["Library/Application Support/Cursor", ".cursor"],
    skillRootSuffix: ".cursor/skills",
  },
  {
    id: "kiro",
    nameZh: "Kiro",
    detectRoots: [".kiro"],
    skillRootSuffix: null,
  },
  {
    id: "gemini-cli",
    nameZh: "Gemini CLI",
    detectRoots: [".gemini"],
    skillRootSuffix: ".gemini/skills",
  },
  {
    id: "opencode",
    nameZh: "OpenCode",
    detectRoots: [".config/opencode", ".local/share/opencode"],
    skillRootSuffix: ".config/opencode/skills",
  },
  {
    id: "openclaw",
    nameZh: "OpenClaw",
    detectRoots: [".openclaw"],
    skillRootSuffix: ".openclaw/skills",
  },
  {
    id: "every-code",
    nameZh: "Every Code",
    detectRoots: [".every-code"],
    skillRootSuffix: null,
  },
  {
    id: "hermes",
    nameZh: "Hermes Agent",
    detectRoots: [".hermes"],
    skillRootSuffix: ".hermes/skills",
  },
  {
    id: "github-copilot",
    nameZh: "GitHub Copilot",
    detectRoots: [".config/github-copilot"],
    skillRootSuffix: null,
  },
  {
    id: "kimi-code",
    nameZh: "Kimi Code",
    detectRoots: [".kimi"],
    skillRootSuffix: null,
  },
  {
    id: "omp",
    nameZh: "oh-my-pi",
    detectRoots: [".omp", ".oh-my-pi"],
    skillRootSuffix: null,
  },
  {
    id: "codebuddy",
    nameZh: "CodeBuddy",
    detectRoots: [".codebuddy"],
    skillRootSuffix: null,
  },
  {
    id: "workbuddy",
    nameZh: "WorkBuddy",
    detectRoots: [".workbuddy"],
    skillRootSuffix: null,
  },
  {
    id: "grok",
    nameZh: "Grok Build",
    detectRoots: [".grok"],
    skillRootSuffix: ".grok/skills",
  },
  {
    id: "kilo-cli",
    nameZh: "Kilo CLI",
    detectRoots: [".kilo", ".local/share/kilo"],
    skillRootSuffix: null,
  },
  {
    id: "kilocode",
    nameZh: "Kilo Code",
    detectRoots: [
      "Library/Application Support/Code/User/globalStorage/kilocode.kilo-code",
    ],
    skillRootSuffix: null,
  },
  {
    id: "antigravity",
    nameZh: "Antigravity",
    detectRoots: [
      ".gemini/antigravity",
      "Library/Application Support/Antigravity",
    ],
    skillRootSuffix: ".gemini/antigravity/skills",
  },
  {
    id: "pi",
    nameZh: "pi",
    detectRoots: [".pi"],
    skillRootSuffix: null,
  },
  {
    id: "craft",
    nameZh: "Craft Agents",
    detectRoots: [".craft-agent"],
    skillRootSuffix: null,
  },
  {
    id: "roo-code",
    nameZh: "Roo Code",
    detectRoots: [
      "Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline",
    ],
    skillRootSuffix: null,
  },
  {
    id: "zed",
    nameZh: "Zed Agent",
    detectRoots: ["Library/Application Support/Zed", ".local/share/zed"],
    skillRootSuffix: null,
  },
  {
    id: "goose",
    nameZh: "Goose",
    detectRoots: [".local/share/goose", ".goose"],
    skillRootSuffix: null,
  },
  {
    id: "droid",
    nameZh: "Droid",
    detectRoots: [".factory"],
    skillRootSuffix: null,
  },
  {
    id: "mimo",
    nameZh: "Mimo Code",
    detectRoots: [".local/share/mimocode"],
    skillRootSuffix: null,
  },
  {
    id: "zcode",
    nameZh: "ZCode",
    detectRoots: [".zcode"],
    skillRootSuffix: null,
  },
  {
    id: "anythingllm",
    nameZh: "AnythingLLM Desktop",
    detectRoots: ["Library/Application Support/anythingllm-desktop"],
    skillRootSuffix: null,
  },
] as const;

/** Stable lowercase-kebab ids for all 27 tools, derived from `AI_TOOLS`. */
export const AI_TOOL_IDS: readonly string[] = AI_TOOLS.map((tool) => tool.id);

/**
 * Tools that expose a skills directory, in catalog order. These back the
 * Skill / Market agent labels.
 */
export const SKILL_TOOL_NAMES: readonly string[] = AI_TOOLS.filter(
  (tool) => tool.skillRootSuffix !== null,
).map((tool) => tool.nameZh);
