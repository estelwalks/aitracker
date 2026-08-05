import { defineTool } from "../define-tool.ts";

/**
 * Roo Code. Usage: adapter reader "generic".
 */
export default defineTool({
  id: "roo-code",
  configVersion: 1,
  display: { name: "Roo Code", nameZh: "Roo Code" },
  detection: {
    roots: [
      "Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline",
    ],
  },

  capabilities: {
    usage: {
      mode: "adapter",
      reader: "generic",
      paths: [
        {
          root: "Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/tasks",
          glob: "**/*.json",
          format: "json",
        },
        {
          root: ".config/Code/User/globalStorage/rooveterinaryinc.roo-cline/tasks",
          glob: "**/*.json",
          format: "json",
        },
        {
          root: "AppData/Roaming/Code/User/globalStorage/rooveterinaryinc.roo-cline/tasks",
          glob: "**/*.json",
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
