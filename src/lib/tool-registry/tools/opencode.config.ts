import { defineTool } from "../define-tool.ts";

/**
 * OpenCode skill agent. Skill roots below; `roots[0]` is the write/sync
 * target (market install destination).
 */
export default defineTool({
  id: "opencode",
  configVersion: 1,
  display: { name: "OpenCode", nameZh: "OpenCode" },
  detection: { roots: [".config/opencode", ".local/share/opencode"] },
  storage: {
    skills: {
      roots: [".config/opencode/skills"],
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
