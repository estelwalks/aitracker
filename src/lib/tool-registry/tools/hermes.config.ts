import { defineTool } from "../define-tool.ts";

/**
 * Hermes Agent skill agent. Skill roots below; `roots[0]` is the write/sync
 * target (market install destination).
 */
export default defineTool({
  id: "hermes",
  configVersion: 1,
  display: { name: "Hermes Agent", nameZh: "Hermes Agent" },
  detection: { roots: [".hermes"] },
  storage: {
    skills: {
      roots: [".hermes/skills"],
      markers: ["SKILL.md", "skill.md"],
      maxDepth: 3,
    },
  },
  capabilities: {
    usage: { mode: "unsupported" },
    skills: { mode: "read-write" },
    agents: { mode: "unsupported" },
    sessions: { mode: "unsupported" },
    market: { mode: "install-target" },
    security: { mode: "unsupported" },
  },
});
