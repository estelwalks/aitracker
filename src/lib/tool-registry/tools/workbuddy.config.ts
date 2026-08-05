import { defineTool } from "../define-tool.ts";

/**
 * WorkBuddy tool definition. M2: detection/display only - all capabilities
 * are `unsupported` until their real storage/log formats are verified and
 * migrated (M3 skills, M4 usage, M5 sessions/pricing).
 */
export default defineTool({
  id: "workbuddy",
  configVersion: 1,
  display: { name: "WorkBuddy", nameZh: "WorkBuddy" },
  detection: { roots: [".workbuddy"] },
  capabilities: {
    usage: { mode: "unsupported" },
    skills: { mode: "unsupported" },
    agents: { mode: "unsupported" },
    sessions: { mode: "unsupported" },
    market: { mode: "unsupported" },
    security: { mode: "unsupported" },
  },
});
