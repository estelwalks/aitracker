import { defineTool } from "../define-tool.ts";

/**
 * Cursor. Usage: adapter reader "generic". Skill agent (read-write, market install target).
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
    usage: {
      mode: "adapter",
      reader: "generic",
      paths: [
        {
          root: "Library/Application Support/Cursor/User/globalStorage",
          glob: "**/*usage*.json",
          format: "json",
        },
        {
          root: "AppData/Roaming/Cursor/User/globalStorage",
          glob: "**/*usage*.json",
          format: "json",
        },
        { root: ".cursor", glob: "**/*usage*.jsonl", format: "jsonl" },
      ],
    },
    skills: { mode: "read-write" },
    agents: { mode: "unsupported" },
    sessions: { mode: "unsupported" },
    market: { mode: "install-target" },
    security: { mode: "unsupported" },
  },
});
