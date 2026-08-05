import { defineTool } from "../define-tool.ts";

/**
 * Gemini CLI skill agent. Skill roots below; `roots[0]` is the write/sync
 * target (market install destination).
 */
export default defineTool({
  id: "gemini-cli",
  configVersion: 1,
  display: { name: "Gemini CLI", nameZh: "Gemini CLI" },
  detection: { roots: [".gemini"] },
  storage: {
    skills: {
      roots: [".gemini/skills"],
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
