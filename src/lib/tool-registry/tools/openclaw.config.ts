import { defineTool } from "../define-tool.ts";

/**
 * OpenClaw skill agent. Skill roots below; `roots[0]` is the write/sync
 * target (market install destination).
 */
export default defineTool({
  id: "openclaw",
  configVersion: 1,
  display: { name: "OpenClaw", nameZh: "OpenClaw" },
  detection: { roots: [".openclaw"] },
  storage: {
    skills: {
      roots: [".openclaw/workspace/skills"],
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
