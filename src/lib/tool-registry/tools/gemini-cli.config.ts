import { defineTool } from "../define-tool.ts";

/**
 * Gemini CLI. Usage: adapter reader "generic". Skill agent (read-write, market install target).
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
    usage: {
      mode: "adapter",
      reader: "generic",
      paths: [
        { root: ".gemini/tmp", glob: "**/chats/*.json", format: "json" },
        { root: ".gemini", glob: "**/*usage*.jsonl", format: "jsonl" },
      ],
    },
    skills: { mode: "read-write" },
    agents: { mode: "unsupported" },
    sessions: { mode: "unsupported" },
    market: { mode: "install-target" },
    security: { mode: "unsupported" },
  },
});
