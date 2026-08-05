import { defineTool } from "../define-tool.ts";

/**
 * Zed Agent tool definition. M2: detection/display only - all capabilities
 * are `unsupported` until their real storage/log formats are verified and
 * migrated (M3 skills, M4 usage, M5 sessions/pricing).
 */
export default defineTool({
  id: "zed",
  configVersion: 1,
  display: { name: "Zed Agent", nameZh: "Zed Agent" },
  detection: { roots: ["Library/Application Support/Zed", ".local/share/zed"] },
  capabilities: {
    usage: { mode: "unsupported" },
    skills: { mode: "unsupported" },
    agents: { mode: "unsupported" },
    sessions: { mode: "unsupported" },
    market: { mode: "unsupported" },
    security: { mode: "unsupported" },
  },
});
