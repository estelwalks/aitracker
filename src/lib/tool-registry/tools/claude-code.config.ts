import { defineTool } from "../define-tool.ts";

/**
 * Claude Code skill agent. Skill roots below; `roots[0]` is the write/sync
 * target (market install destination).
 */
export default defineTool({
  id: "claude-code",
  configVersion: 1,
  display: { name: "Claude Code", nameZh: "Claude Code" },
  detection: { roots: [".claude", "Library/Application Support/Claude"] },
  storage: {
    skills: {
      roots: [".claude/skills"],
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
