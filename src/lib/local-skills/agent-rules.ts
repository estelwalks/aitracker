/**
 * Per-agent skill discovery rules, aligned with the AITracker (MIT)
 * reference behavior: a skill is a DIRECTORY containing a marker file
 * (`SKILL.md` or `skill.md`, exact case), discovered with bounded recursion.
 *
 * Clean Room: only the observable discovery behavior is aligned — this is
 * AITracker's own config shape, types and naming. No AITracker code,
 * structure, naming or comments are copied.
 */

import { basename, join } from "node:path";

import { AI_TOOLS } from "../tools/catalog.ts";

export interface SkillAgentRule {
  /** Catalog tool id (`AI_TOOLS[].id`). */
  toolId: string;
  /** HOME-relative roots (multiple allowed); `[0]` is the write path. */
  roots: readonly string[];
  /**
   * Env var whose value replaces the directory part of each root (the tool's
   * home directory) when set to a non-empty string (codex/grok only). The
   * last path segment is kept: the root becomes
   * `join(envValue, basename(suffix))` — e.g. `CODEX_HOME=/x` makes
   * `.codex/skills` resolve to `/x/skills`.
   */
  envHome?: string;
  /** Marker files, checked in order; default `["SKILL.md", "skill.md"]`. */
  markers?: readonly string[];
  /** Max discovery depth counting from the root (root = 0); default 3. */
  maxDepth?: number;
}

export const DEFAULT_MARKERS: readonly string[] = ["SKILL.md", "skill.md"];
export const DEFAULT_MAX_DEPTH = 3;

/**
 * The nine skill agents, in UI order. Each entry maps a catalog tool to its
 * skill roots; `[0]` is the write path (sync/install target).
 */
export const SKILL_AGENT_RULES: readonly SkillAgentRule[] = [
  { toolId: "claude-code", roots: [".claude/skills"] },
  { toolId: "codex", roots: [".codex/skills"], envHome: "CODEX_HOME" },
  { toolId: "cursor", roots: [".cursor/skills"] },
  { toolId: "gemini-cli", roots: [".gemini/skills"] },
  { toolId: "opencode", roots: [".config/opencode/skills"] },
  { toolId: "grok", roots: [".grok/skills"], envHome: "GROK_HOME" },
  { toolId: "hermes", roots: [".hermes/skills"] },
  { toolId: "openclaw", roots: [".openclaw/workspace/skills"] },
  {
    toolId: "antigravity",
    roots: [".gemini/antigravity/skills", ".gemini/antigravity-ide/skills"],
  },
];

const nameZhById = new Map<string, string>(
  AI_TOOLS.map((tool) => [tool.id, tool.nameZh] as const),
);

/**
 * Fail-fast module-load validation: every rule must reference a known catalog
 * tool and derive a unique agent label.
 */
function assertRulesValid(): void {
  const labels = new Set<string>();
  for (const rule of SKILL_AGENT_RULES) {
    const nameZh = nameZhById.get(rule.toolId);
    if (nameZh === undefined) {
      throw new Error(
        `SkillAgentRule 引用了未知工具 id "${rule.toolId}"（不在 AI_TOOLS 中）`,
      );
    }
    if (labels.has(nameZh)) {
      throw new Error(`Skill agent label 重复: "${nameZh}"`);
    }
    labels.add(nameZh);
  }
}
assertRulesValid();

function agentLabelOf(rule: SkillAgentRule): string {
  const label = nameZhById.get(rule.toolId);
  if (label === undefined) {
    throw new Error(`SkillAgentRule 引用了未知工具 id "${rule.toolId}"`);
  }
  return label;
}

/**
 * Skill agent labels (the catalog `nameZh` of every rule), in rule order.
 */
export const SKILL_AGENTS: readonly string[] =
  SKILL_AGENT_RULES.map(agentLabelOf);

/**
 * Label → `roots[0]` (the write path). Compatibility export: existing callers
 * (and tests) look up `SKILL_ROOT_SUFFIXES["Claude Code"]`.
 */
export const SKILL_ROOT_SUFFIXES: Record<string, string> = Object.fromEntries(
  SKILL_AGENT_RULES.map((rule) => [agentLabelOf(rule), rule.roots[0]]),
);

/**
 * Resolve each agent's skill roots against a home directory. When a rule has
 * `envHome` and the corresponding env var is a non-empty string, the env value
 * replaces the directory part of each root (the tool's home directory) while
 * keeping the last path segment: `join(envValue, basename(suffix))`. Empty
 * strings are treated as unset and fall back to `join(home, suffix)`.
 */
export function resolveAgentRoots(
  home: string,
  env: Record<string, string | undefined>,
): Record<string, string[]> {
  const roots: Record<string, string[]> = {};
  for (const rule of SKILL_AGENT_RULES) {
    const envValue = rule.envHome == null ? undefined : env[rule.envHome];
    const overridden = envValue !== undefined && envValue !== "";
    roots[agentLabelOf(rule)] = rule.roots.map((suffix) =>
      overridden ? join(envValue, basename(suffix)) : join(home, suffix),
    );
  }
  return roots;
}
