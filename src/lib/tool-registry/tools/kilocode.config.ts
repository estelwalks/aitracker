import { defineTool } from "../define-tool.ts";

/**
 * Kilo Code tool definition. M2: detection/display only - all capabilities
 * are `unsupported` until their real storage/log formats are verified and
 * migrated (M3 skills, M4 usage, M5 sessions/pricing).
 */
export default defineTool({
  id: "kilocode",
  configVersion: 1,
  display: { name: "Kilo Code", nameZh: "Kilo Code" },
  detection: {
    roots: [
      "Library/Application Support/Code/User/globalStorage/kilocode.kilo-code",
    ],
  },
  capabilities: {
    usage: { mode: "unsupported" },
    skills: { mode: "unsupported" },
    agents: { mode: "unsupported" },
    sessions: { mode: "unsupported" },
    market: { mode: "unsupported" },
    security: { mode: "unsupported" },
  },
});
