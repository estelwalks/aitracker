import { defineTool } from "../define-tool.ts";

/**
 * Codex CLI. Usage: native reader "codex-rollout-v1". Skill agent (read-write, market install target).
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
    usage: {
      mode: "native",
      reader: "codex-rollout-v1",
      paths: [
        {
          root: ".codex/sessions",
          glob: "**/rollout-*.jsonl",
          format: "jsonl",
        },
        {
          root: ".codex/archived_sessions",
          glob: "**/rollout-*.jsonl",
          format: "jsonl",
        },
      ],
    },
    skills: { mode: "read-write" },
    agents: { mode: "unsupported" },
    sessions: {
      mode: "resume",
      reader: "codex-session-v1",
      command: ["codex", "resume", "{sessionId}"],
    },
    market: { mode: "install-target" },
    security: { mode: "unsupported" },
  },
});
