import { defineTool } from "../define-tool.ts";

/**
 * Cursor skill agent. Skill roots below; `roots[0]` is the write/sync
 * target (market install destination).
 */
export default defineTool({
  id: "cursor",
  configVersion: 1,
  display: { name: "Cursor", nameZh: "Cursor" },
  detection: { roots: ["Library/Application Support/Cursor", ".cursor"] },
  storage: {
    skills: {
      roots: [".cursor/skills"],
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
