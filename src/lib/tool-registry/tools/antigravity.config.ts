import { defineTool } from "../define-tool.ts";

/**
 * Antigravity skill agent. Skill roots below; `roots[0]` is the write/sync
 * target (market install destination).
 */
export default defineTool({
  id: "antigravity",
  configVersion: 1,
  display: { name: "Antigravity", nameZh: "Antigravity" },
  detection: {
    roots: [".gemini/antigravity", "Library/Application Support/Antigravity"],
  },
  storage: {
    skills: {
      roots: [".gemini/antigravity/skills", ".gemini/antigravity-ide/skills"],
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
