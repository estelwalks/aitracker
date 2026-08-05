import { defineTool } from "../define-tool.ts";

/**
 * Kimi Code tool definition. M2: detection/display only - all capabilities
 * are `unsupported` until their real storage/log formats are verified and
 * migrated (M3 skills, M4 usage, M5 sessions/pricing).
 */
export default defineTool({
  id: "kimi-code",
  configVersion: 1,
  display: { name: "Kimi Code", nameZh: "Kimi Code" },
  detection: { roots: [".kimi"] },
  capabilities: {
    usage: { mode: "unsupported" },
    skills: { mode: "unsupported" },
    agents: { mode: "unsupported" },
    sessions: { mode: "unsupported" },
    market: { mode: "unsupported" },
    security: { mode: "unsupported" },
  },
});
