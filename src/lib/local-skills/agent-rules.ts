/**
 * Per-agent skill discovery rules, now derived from the tool-registry.
 *
 * The single source of truth for skill storage is each tool's `storage.skills`
 * config. This module projects the registry into the legacy `SKILL_AGENT_RULES`
 * / `SKILL_AGENTS` / `SKILL_ROOT_SUFFIXES` shape so existing scanners, market
 * targets and tests keep working unchanged.
 *
 * Browser note: this module is imported by browser code (SKILL_AGENTS labels).
 * It is safe through M3 because configs carry no reader keys, commands, or
 * pricing. M4-T1 migrates browser consumers to `public-manifest.generated.ts`
 * and this module becomes server-only.
 */
import type { ToolDefinition } from "../tool-registry/contracts.ts";
import { listTools } from "../tool-registry/registry.ts";

export interface SkillAgentRule {
  /** Catalog tool id (`AI_TOOLS[].id`). */
  toolId: string;
  /** HOME-relative roots (multiple allowed); `[0]` is the write path. */
  roots: readonly string[];
  /**
   * Env var whose value replaces the directory part of each root (the tool's
   * home directory) when set to a non-empty string (codex/grok only).
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
 * Canonical UI order of skill agents. The registry stores skill DATA per tool;
 * this list only fixes the DISPLAY order (frozen from the pre-migration
 * `SKILL_AGENT_RULES` array) so the Skills/Market pages do not visually
 * reorder. It must stay in sync with the set of skill-capable tools - the
 * `assertSkillOrderInSync` check enforces that below.
 */
const SKILL_AGENT_ORDER: readonly string[] = [
  "claude-code",
  "codex",
  "cursor",
  "gemini-cli",
  "opencode",
  "grok",
  "hermes",
  "openclaw",
  "antigravity",
];

/** Tools that have a non-unsupported skills capability. */
const SKILL_TOOL_BY_ID: ReadonlyMap<string, ToolDefinition> = new Map(
  listTools()
    .filter(
      (def) =>
        def.capabilities.skills.mode !== "unsupported" &&
        def.storage?.skills &&
        def.storage.skills.roots.length > 0,
    )
    .map((def) => [def.id, def]),
);

function toRule(def: ToolDefinition): SkillAgentRule {
  const skills = def.storage!.skills!;
  return {
    toolId: def.id,
    roots: skills.roots,
    ...(skills.envHome ? { envHome: skills.envHome } : {}),
    ...(skills.markers ? { markers: skills.markers } : {}),
    ...(skills.maxDepth !== undefined ? { maxDepth: skills.maxDepth } : {}),
  };
}

/**
 * The skill agents, in the canonical UI order. Each entry maps a tool to its
 * skill roots; `[0]` is the write path (sync/install target).
 */
export const SKILL_AGENT_RULES: readonly SkillAgentRule[] =
  SKILL_AGENT_ORDER.map((id) => SKILL_TOOL_BY_ID.get(id))
    .filter((def): def is ToolDefinition => def !== undefined)
    .map(toRule);

/**
 * Skill agent labels (the registry `nameZh` of every skill tool), in order.
 */
export const SKILL_AGENTS: readonly string[] = SKILL_AGENT_RULES.map(
  (rule) => SKILL_TOOL_BY_ID.get(rule.toolId)!.display.nameZh,
);

/**
 * Fail-fast module-load validation: the order list must exactly cover the
 * skill-capable registry tools (no missing/extra), and labels must be unique.
 */
function assertSkillConfigValid(): void {
  const registrySkillIds = new Set([...SKILL_TOOL_BY_ID.keys()].sort());
  const orderIds = new Set(SKILL_AGENT_ORDER);
  if (
    registrySkillIds.size !== orderIds.size ||
    ![...registrySkillIds].every((id) => orderIds.has(id))
  ) {
    throw new Error(
      `SKILL_AGENT_ORDER 与 registry 的 skill 工具集不一致 (order=${[...orderIds].sort().join(",")}, registry=${[...registrySkillIds].join(",")})`,
    );
  }
  const labels = new Set<string>();
  for (const label of SKILL_AGENTS) {
    if (labels.has(label)) {
      throw new Error(`Skill agent label 重复: "${label}"`);
    }
    labels.add(label);
  }
}
assertSkillConfigValid();

/**
 * Label -> `roots[0]` (the write path). Compatibility export: existing callers
 * (and tests) look up `SKILL_ROOT_SUFFIXES["Claude Code"]`.
 */
export const SKILL_ROOT_SUFFIXES: Record<string, string> = Object.fromEntries(
  SKILL_AGENT_RULES.map((rule) => [
    SKILL_TOOL_BY_ID.get(rule.toolId)!.display.nameZh,
    rule.roots[0],
  ]),
);
