import type { UsageAdapterContract, UsageFieldMapping } from "./types.ts";
import { listTools } from "../../tool-registry/registry.ts";

export const GENERIC_ADAPTER_MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024;

const COMMON_MAPPING: UsageFieldMapping = {
  records: [
    "events",
    "messages",
    "turns",
    "history",
    "items",
    "data.events",
    "data.messages",
  ],
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

/**
 * Built-in usage adapters, derived from the tool-registry: one entry per tool
 * (including `catalogVisible=false` legacy sources aipy/cline) with a
 * non-unsupported `usage` capability. The scanner still dispatches native
 * readers (claude-code/codex/workbuddy) via hardcoded calls; this catalog feeds
 * the generic adapter pipeline and the source-id universe.
 */
const REGISTRY_USAGE_ADAPTERS: UsageAdapterContract[] = listTools()
  .filter(
    (def) =>
      def.capabilities.usage.mode !== "unsupported" &&
      def.capabilities.usage.paths &&
      def.capabilities.usage.paths.length > 0,
  )
  .map((def) => {
    const usage = def.capabilities.usage;
    const entry: UsageAdapterContract = {
      source: def.id,
      paths: [...usage.paths!],
      mapping:
        (usage.mapping as UsageFieldMapping | undefined) ?? COMMON_MAPPING,
      maxFileSizeBytes:
        usage.maxFileSizeBytes ?? GENERIC_ADAPTER_MAX_FILE_SIZE_BYTES,
      kind: "builtin",
    };
    if (usage.query) entry.query = usage.query;
    return entry;
  });

export const BUILTIN_USAGE_ADAPTERS: UsageAdapterContract[] = [
  ...REGISTRY_USAGE_ADAPTERS,
];

export const GENERIC_BUILTIN_USAGE_ADAPTERS = BUILTIN_USAGE_ADAPTERS.filter(
  (adapter) => adapter.source !== "claude-code" && adapter.source !== "codex",
);
