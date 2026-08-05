import { defineTool } from "../define-tool.ts";

/**
 * Grok Build. Usage: adapter reader "generic". Skill agent (read-write, market install target).
 */
export default defineTool({
  id: "grok",
  configVersion: 1,
  display: { name: "Grok Build", nameZh: "Grok Build" },
  detection: { roots: [".grok"] },
  storage: {
    skills: {
      roots: [".grok/skills"],
      envHome: "GROK_HOME",
      markers: ["SKILL.md", "skill.md"],
      maxDepth: 3,
    },
  },
  capabilities: {
    usage: {
      mode: "adapter",
      reader: "generic",
      paths: [
        { root: ".grok/sessions", glob: "**/*.jsonl", format: "jsonl" },
        { root: ".grok/logs", glob: "**/*.jsonl", format: "jsonl" },
      ],
    },
    skills: { mode: "read-write" },
    agents: { mode: "unsupported" },
    sessions: { mode: "unsupported" },
    market: { mode: "install-target" },
    security: { mode: "unsupported" },
  },
});
