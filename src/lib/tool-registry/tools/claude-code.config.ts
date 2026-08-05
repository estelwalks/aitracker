import { defineTool } from "../define-tool.ts";

/**
 * Claude Code. Usage: native reader "claude-rollout-v1". Skill agent (read-write, market install target).
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
    usage: {
      mode: "native",
      reader: "claude-rollout-v1",
      paths: [
        { root: ".claude/projects", glob: "**/*.jsonl", format: "jsonl" },
      ],
    },
    skills: { mode: "read-write" },
    agents: { mode: "unsupported" },
    sessions: {
      mode: "resume",
      reader: "claude-session-v1",
      command: ["claude", "--resume", "{sessionId}"],
    },
    market: { mode: "install-target" },
    security: { mode: "unsupported" },
  },
});
