/**
 * Server-only skill discovery rules with real filesystem paths.
 *
 * `agent-rules.ts` is browser-safe (labels only, derived from the public
 * manifest). The path-bearing `SKILL_AGENT_RULES` / `SKILL_ROOT_SUFFIXES` live
 * here so the browser bundle never receives skill roots. Data comes from the
 * tool-registry; order comes from the shared `SKILL_AGENT_ORDER`.
 */
import type { ToolDefinition } from "../tool-registry/contracts.ts";
import { listTools } from "../tool-registry/registry.ts";
import { SKILL_AGENT_ORDER, type SkillAgentRule } from "./agent-rules.ts";

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
 * The nine skill agents, in canonical UI order. Each entry maps a tool to its
 * skill roots; `[0]` is the write path (sync/install target).
 */
export const SKILL_AGENT_RULES: readonly SkillAgentRule[] =
  SKILL_AGENT_ORDER.map((id) => SKILL_TOOL_BY_ID.get(id))
    .filter((def): def is ToolDefinition => def !== undefined)
    .map(toRule);

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
