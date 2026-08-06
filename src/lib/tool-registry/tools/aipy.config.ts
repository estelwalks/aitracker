import { defineTool } from "../define-tool.ts";

/**
 * AiPy (legacy collection source). Not in the 27-tool product catalog
 * (`catalogVisible=false`) but kept as a real usage source so the generic
 * sqlite reader can scan it. The SQL query + field mapping are data (no I/O);
 * the reader implementation is the controlled `generic-sqlite` key.
 */
export default defineTool({
  id: "aipy",
  configVersion: 1,
  catalogVisible: false,
  display: { name: "AiPy", nameZh: "AiPy" },
  detection: {
    roots: ["Library/Application Support/aipy-pro", "AppData/Roaming/aipy-pro"],
  },
  capabilities: {
    usage: {
      mode: "adapter",
      reader: "generic-sqlite",
      maxFileSizeBytes: 512 * 1024 * 1024,
      paths: [
        {
          root: "Library/Application Support/aipy-pro",
          glob: "aipy",
          format: "sqlite",
        },
        { root: "AppData/Roaming/aipy-pro", glob: "aipy", format: "sqlite" },
      ],
      query: `SELECT
  e.time AS timestamp,
  e.task_id AS sessionId,
  COALESCE(NULLIF(e.model, ''), NULLIF(t.model, ''), 'unknown') AS model,
  COALESCE(NULLIF(t.workdir, ''), 'unknown') AS project,
  CAST(COALESCE(json_extract(e.usage, '$.input_tokens'), 0) AS INTEGER) AS inputTokens,
  CAST(COALESCE(json_extract(e.usage, '$.output_tokens'), 0) AS INTEGER) AS outputTokens,
  CAST(COALESCE(json_extract(e.usage, '$.reasoning_tokens'), 0) AS INTEGER) AS reasoningOutputTokens,
  CAST(COALESCE(json_extract(e.usage, '$.total_tokens'), 0) AS INTEGER) AS totalTokens
FROM task_event e
LEFT JOIN task t ON t.id = e.task_id
WHERE e.usage IS NOT NULL AND e.usage <> ''`,
      mapping: {
        timestamp: ["timestamp"],
        sessionId: ["sessionId"],
        model: ["model"],
        project: ["project"],
        inputTokens: ["inputTokens"],
        outputTokens: ["outputTokens"],
        reasoningOutputTokens: ["reasoningOutputTokens"],
        totalTokens: ["totalTokens"],
      },
    },
    skills: { mode: "unsupported" },
    agents: { mode: "unsupported" },
    sessions: { mode: "unsupported" },
    market: { mode: "unsupported" },
    security: { mode: "unsupported" },
  },
});
