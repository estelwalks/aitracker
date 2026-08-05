import { defineTool } from "../define-tool.ts";

/**
 * Grok Build skill agent. Skill roots below; `roots[0]` is the write/sync
 * target (market install destination). When GROK_HOME is a non-empty value, it replaces the tool home directory (keeping the last path segment).
 */
export default defineTool({
  id: "grok",
  configVersion: 1,
  display: { name: "Grok Build", nameZh: "Grok Build" },
  detection: { roots: [".grok"] },
  storage: {
    skills: {
      roots: [".grok/skills"],
      envHome: "GROK_HOME",
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
