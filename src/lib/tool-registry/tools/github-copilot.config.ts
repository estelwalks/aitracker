import { defineTool } from "../define-tool.ts";

/**
 * GitHub Copilot. Usage: adapter reader "generic".
 */
export default defineTool({
  id: "github-copilot",
  configVersion: 1,
  display: { name: "GitHub Copilot", nameZh: "GitHub Copilot" },
  detection: { roots: [".config/github-copilot"] },

  capabilities: {
    usage: {
      mode: "adapter",
      reader: "generic",
      paths: [
        {
          root: ".config/github-copilot",
          glob: "**/*usage*.jsonl",
          format: "jsonl",
        },
        {
          root: "Library/Application Support/github-copilot",
          glob: "**/*usage*.json",
          format: "json",
        },
        {
          root: "AppData/Roaming/github-copilot",
          glob: "**/*usage*.json",
          format: "json",
        },
      ],
    },
    skills: { mode: "unsupported" },
    agents: { mode: "unsupported" },
    sessions: { mode: "unsupported" },
    market: { mode: "unsupported" },
    security: { mode: "unsupported" },
  },
});
