import { defineTool } from "../define-tool.ts";

/**
 * Codex CLI skill agent. Skill roots below; `roots[0]` is the write/sync
 * target (market install destination). When CODEX_HOME is a non-empty value, it replaces the tool home directory (keeping the last path segment).
 */
export default defineTool({
  id: "codex",
  configVersion: 1,
  display: { name: "Codex CLI", nameZh: "Codex CLI" },
  detection: { roots: [".codex"] },
  storage: {
    skills: {
      roots: [".codex/skills"],
      envHome: "CODEX_HOME",
      markers: ["SKILL.md", "skill.md"],
      maxDepth: 3,
    },
  },
  capabilities: {
    usage: { mode: "unsupported" },
    skills: { mode: "read-write" },
    agents: { mode: "unsupported" },
    sessions: { mode: "unsupported" },
    market: { mode: "install-target" },
    security: { mode: "unsupported" },
  },
});
