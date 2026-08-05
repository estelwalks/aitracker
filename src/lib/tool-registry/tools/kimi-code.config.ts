import { defineTool } from "../define-tool.ts";

/**
 * Kimi Code. Usage: adapter reader "generic".
 */
export default defineTool({
  id: "kimi-code",
  configVersion: 1,
  display: { name: "Kimi Code", nameZh: "Kimi Code" },
  detection: { roots: [".kimi"] },

  capabilities: {
    usage: {
      mode: "adapter",
      reader: "generic",
      paths: [
        { root: ".kimi/sessions", glob: "**/*.jsonl", format: "jsonl" },
        { root: ".kimi/logs", glob: "**/*.jsonl", format: "jsonl" },
      ],
    },
    skills: { mode: "unsupported" },
    agents: { mode: "unsupported" },
    sessions: { mode: "unsupported" },
    market: { mode: "unsupported" },
    security: { mode: "unsupported" },
  },
});
