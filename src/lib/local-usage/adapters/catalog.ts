import type { UsageAdapterContract, UsageFieldMapping } from "./types.ts";
import { USAGE_ADAPTER_PRESETS } from "./presets.ts";

export const GENERIC_ADAPTER_MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024;

const COMMON_MAPPING: UsageFieldMapping = {
  records: ["events", "messages", "turns", "history", "items", "data.events", "data.messages"],
  timestamp: [
    "timestamp",
    "created_at",
    "createdAt",
    "time",
    "metadata.timestamp",
    "usage.timestamp",
  ],
  sessionId: [
    "session_id",
    "sessionId",
    "conversation_id",
    "conversationId",
    "thread_id",
    "threadId",
    "message.session_id",
    "message.sessionId",
    "metadata.session_id",
    "metadata.sessionId",
  ],
  model: ["model", "model_id", "modelId", "metadata.model", "usage.model"],
  project: [
    "cwd",
    "project",
    "project_path",
    "projectPath",
    "workspace",
    "workspace_path",
    "metadata.cwd",
  ],
  inputTokens: [
    "usage.input_tokens",
    "usage.inputTokens",
    "token_usage.input_tokens",
    "tokenUsage.inputTokens",
    "tokens.input",
    "metrics.input_tokens",
  ],
  cachedInputTokens: [
    "usage.cached_input_tokens",
    "usage.cache_read_input_tokens",
    "usage.cachedInputTokens",
    "token_usage.cached_input_tokens",
    "tokenUsage.cachedInputTokens",
    "tokens.cached_input",
  ],
  cacheCreationInputTokens: [
    "usage.cache_creation_input_tokens",
    "usage.cacheCreationInputTokens",
    "token_usage.cache_creation_input_tokens",
    "tokens.cache_creation_input",
  ],
  outputTokens: [
    "usage.output_tokens",
    "usage.outputTokens",
    "token_usage.output_tokens",
    "tokenUsage.outputTokens",
    "tokens.output",
    "metrics.output_tokens",
  ],
  reasoningOutputTokens: [
    "usage.reasoning_output_tokens",
    "usage.reasoningOutputTokens",
    "token_usage.reasoning_output_tokens",
    "tokens.reasoning",
  ],
  totalTokens: [
    "usage.total_tokens",
    "usage.totalTokens",
    "token_usage.total_tokens",
    "tokenUsage.totalTokens",
    "tokens.total",
    "metrics.total_tokens",
  ],
};

function builtin(
  source: UsageAdapterContract["source"],
  paths: UsageAdapterContract["paths"],
  mapping: UsageFieldMapping = COMMON_MAPPING,
): UsageAdapterContract {
  return {
    source,
    paths,
    mapping,
    maxFileSizeBytes: GENERIC_ADAPTER_MAX_FILE_SIZE_BYTES,
    kind: "builtin",
  };
}

export const BUILTIN_USAGE_ADAPTERS: UsageAdapterContract[] = [
  builtin("claude-code", [{ root: ".claude/projects", glob: "**/*.jsonl", format: "jsonl" }]),
  builtin("codex", [
    { root: ".codex/sessions", glob: "**/rollout-*.jsonl", format: "jsonl" },
    { root: ".codex/archived_sessions", glob: "**/rollout-*.jsonl", format: "jsonl" },
  ]),
  builtin("cursor", [
    {
      root: "Library/Application Support/Cursor/User/globalStorage",
      glob: "**/*usage*.json",
      format: "json",
    },
    {
      root: "AppData/Roaming/Cursor/User/globalStorage",
      glob: "**/*usage*.json",
      format: "json",
    },
    { root: ".cursor", glob: "**/*usage*.jsonl", format: "jsonl" },
  ]),
  builtin("gemini-cli", [
    { root: ".gemini/tmp", glob: "**/chats/*.json", format: "json" },
    { root: ".gemini", glob: "**/*usage*.jsonl", format: "jsonl" },
  ]),
  builtin("kimi-code", [
    { root: ".kimi/sessions", glob: "**/*.jsonl", format: "jsonl" },
    { root: ".kimi/logs", glob: "**/*.jsonl", format: "jsonl" },
  ]),
  builtin("opencode", [
    { root: ".local/share/opencode/storage/message", glob: "**/*.json", format: "json" },
    { root: ".opencode", glob: "**/*.jsonl", format: "jsonl" },
  ]),
  builtin("grok", [
    { root: ".grok/sessions", glob: "**/*.jsonl", format: "jsonl" },
    { root: ".grok/logs", glob: "**/*.jsonl", format: "jsonl" },
  ]),
  builtin("github-copilot", [
    { root: ".config/github-copilot", glob: "**/*usage*.jsonl", format: "jsonl" },
    {
      root: "Library/Application Support/github-copilot",
      glob: "**/*usage*.json",
      format: "json",
    },
    {
      root: "AppData/Roaming/github-copilot",
      glob: "**/*usage*.json",
      format: "json",
    },
  ]),
  builtin("cline", [
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
  ]),
  builtin("roo-code", [
    {
      root: "Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/tasks",
      glob: "**/*.json",
      format: "json",
    },
    {
      root: ".config/Code/User/globalStorage/rooveterinaryinc.roo-cline/tasks",
      glob: "**/*.json",
      format: "json",
    },
    {
      root: "AppData/Roaming/Code/User/globalStorage/rooveterinaryinc.roo-cline/tasks",
      glob: "**/*.json",
      format: "json",
    },
  ]),
  {
    source: "aipy",
    paths: [...USAGE_ADAPTER_PRESETS.aipy.paths],
    mapping: USAGE_ADAPTER_PRESETS.aipy.mapping,
    query: USAGE_ADAPTER_PRESETS.aipy.query,
    maxFileSizeBytes: 512 * 1024 * 1024,
    kind: "builtin",
  },
  builtin(
    "workbuddy",
    [...USAGE_ADAPTER_PRESETS.workbuddy.paths],
    USAGE_ADAPTER_PRESETS.workbuddy.mapping,
  ),
];

export const GENERIC_BUILTIN_USAGE_ADAPTERS = BUILTIN_USAGE_ADAPTERS.filter(
  (adapter) => adapter.source !== "claude-code" && adapter.source !== "codex",
);
