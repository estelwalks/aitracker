import { defineTool } from "../define-tool.ts";

/**
 * Codex CLI tool definition. M2: detection/display only - all capabilities
 * are `unsupported` until their real storage/log formats are verified and
 * migrated (M3 skills, M4 usage, M5 sessions/pricing).
 */
export default defineTool({
  id: "codex",
  configVersion: 1,
  display: { name: "Codex CLI", nameZh: "Codex CLI" },
  detection: { roots: [".codex"] },
  capabilities: {
    usage: { mode: "unsupported" },
    skills: { mode: "unsupported" },
    agents: { mode: "unsupported" },
    sessions: { mode: "unsupported" },
    market: { mode: "unsupported" },
    security: { mode: "unsupported" },
  },
});
