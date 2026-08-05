/**
 * Browser-safe skill-agent labels and shared constants.
 *
 * This module is imported by browser code (SKILL_AGENTS labels via
 * `local-skills/types.ts`). It derives labels from the public manifest ONLY -
 * never the full registry - so the browser bundle never receives skill paths,
 * reader keys, commands, or pricing. The path-bearing `SKILL_AGENT_RULES` lives
 * in the server-only `skill-rules.server.ts`.
 */
import { PUBLIC_TOOL_MANIFEST } from "../tool-registry/public-manifest.generated.ts";

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
 * Canonical UI order of skill agents. Shared with `skill-rules.server.ts` so
 * server (rules) and browser (labels) agree on order. Must stay in sync with the
 * set of skill-capable tools - enforced by the registry/verify diagnostics.
 */
export const SKILL_AGENT_ORDER: readonly string[] = [
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

const MANIFEST_BY_ID: ReadonlyMap<
  string,
  (typeof PUBLIC_TOOL_MANIFEST)["tools"][number]
> = new Map(PUBLIC_TOOL_MANIFEST.tools.map((tool) => [tool.id, tool]));

function isSkillTool(id: string): boolean {
  const entry = MANIFEST_BY_ID.get(id);
  return entry?.capabilities.skills !== "unsupported";
}

/**
 * Skill agent labels (the manifest `nameZh` of every skill tool), in canonical
 * order.
 */
export const SKILL_AGENTS: readonly string[] = SKILL_AGENT_ORDER.filter(
  isSkillTool,
).map((id) => MANIFEST_BY_ID.get(id)!.nameZh);

/**
 * Fail-fast module-load validation: derived labels must be unique.
 */
function assertLabelsUnique(): void {
  const labels = new Set<string>();
  for (const label of SKILL_AGENTS) {
    if (labels.has(label)) {
      throw new Error(`Skill agent label 重复: "${label}"`);
    }
    labels.add(label);
  }
}
assertLabelsUnique();
