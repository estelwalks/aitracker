import { defineTool } from "../define-tool.ts";

/**
 * WorkBuddy. Usage: native reader "workbuddy-native".
 */
export default defineTool({
  id: "workbuddy",
  configVersion: 1,
  display: { name: "WorkBuddy", nameZh: "WorkBuddy" },
  detection: { roots: [".workbuddy"] },

  capabilities: {
    usage: {
      mode: "native",
      reader: "workbuddy-native",
      paths: [
        { root: ".workbuddy/projects", glob: "**/*.jsonl", format: "jsonl" },
      ],
    },
    skills: { mode: "unsupported" },
    agents: { mode: "unsupported" },
    sessions: { mode: "unsupported" },
    market: { mode: "unsupported" },
    security: { mode: "unsupported" },
  },
});
