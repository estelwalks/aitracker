import { defineTool } from "../define-tool.ts";

/**
 * OpenCode. Usage: adapter reader "generic". Skill agent (read-write, market install target).
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
    usage: {
      mode: "adapter",
      reader: "generic",
      paths: [
        {
          root: ".local/share/opencode/storage/message",
          glob: "**/*.json",
          format: "json",
        },
        { root: ".opencode", glob: "**/*.jsonl", format: "jsonl" },
      ],
    },
    skills: { mode: "read-write" },
    agents: { mode: "unsupported" },
    sessions: { mode: "unsupported" },
    market: { mode: "install-target" },
    security: { mode: "unsupported" },
  },
});
