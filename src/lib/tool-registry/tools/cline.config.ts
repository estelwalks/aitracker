import { defineTool } from "../define-tool.ts";

/**
 * Cline (legacy collection source). Not in the 27-tool product catalog
 * (`catalogVisible=false`) but kept as a real usage source scanned by the
 * generic json reader. Field mapping falls back to the shared common mapping.
 */
export default defineTool({
  id: "cline",
  configVersion: 1,
  catalogVisible: false,
  display: { name: "Cline", nameZh: "Cline" },
  detection: {
    roots: [
      "Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev",
      ".config/Code/User/globalStorage/saoudrizwan.claude-dev",
      "AppData/Roaming/Code/User/globalStorage/saoudrizwan.claude-dev",
    ],
  },
  capabilities: {
    usage: {
      mode: "adapter",
      reader: "generic-json",
      paths: [
        {
          root: "Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/tasks",
          glob: "**/*.json",
          format: "json",
        },
        {
          root: ".config/Code/User/globalStorage/saoudrizwan.claude-dev/tasks",
          glob: "**/*.json",
          format: "json",
        },
        {
          root: "AppData/Roaming/Code/User/globalStorage/saoudrizwan.claude-dev/tasks",
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
