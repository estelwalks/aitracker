import type { ExternalUsageAdapterConfig } from "./types.ts";

export const USAGE_ADAPTER_PRESETS = {
  aipy: {
    id: "aipy",
    paths: [
      {
        root: "Library/Application Support/aipy-pro",
        glob: "aipy",
        format: "sqlite",
      },
      {
        root: "AppData/Roaming/aipy-pro",
        glob: "aipy",
        format: "sqlite",
      },
    ],
    query: `
SELECT
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
WHERE e.usage IS NOT NULL AND e.usage <> ''
    `.trim(),
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
  workbuddy: {
    id: "workbuddy",
    paths: [
      {
        root: ".workbuddy/projects",
        glob: "**/*.jsonl",
        format: "jsonl",
      },
    ],
    mapping: {
      timestamp: ["timestamp"],
      sessionId: ["sessionId"],
      model: ["providerData.requestModelName", "providerData.requestModelId", "providerData.model"],
      project: ["cwd"],
      inputTokens: [
        "providerData.rawUsage.prompt_cache_miss_tokens",
        "message.usage.input_tokens",
        "providerData.usage.input_tokens",
      ],
      cachedInputTokens: [
        "providerData.rawUsage.cache_read_input_tokens",
        "providerData.rawUsage.cached_tokens",
      ],
      outputTokens: [
        "providerData.rawUsage.completion_tokens",
        "message.usage.output_tokens",
        "providerData.usage.output_tokens",
      ],
      reasoningOutputTokens: ["providerData.rawUsage.completion_thinking_tokens"],
      totalTokens: ["message.usage.total_tokens", "providerData.usage.total_tokens"],
    },
  },
} as const satisfies Record<string, ExternalUsageAdapterConfig>;

export type UsageAdapterPresetId = keyof typeof USAGE_ADAPTER_PRESETS;
