import type { UsageAdapterContract, UsageFieldMapping } from "./types.ts";
import { USAGE_ADAPTER_PRESETS } from "./presets.ts";
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

/**
 * Built-in usage adapters, derived from the tool-registry: one entry per tool
 * with a non-unsupported `usage` capability, plus two LEGACY adapter sources
 * (`cline`, `aipy`) that are real tools but not in the 27-tool PRD catalog and
 * therefore have no `*.config.ts`. The scanner still dispatches native readers
 * (claude-code/codex/workbuddy) via hardcoded calls; this catalog feeds the
 * generic adapter pipeline and the source-id universe.
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

// cline / aipy are usage sources but not PRD catalog tools -> legacy entries.
const LEGACY_USAGE_ADAPTERS: UsageAdapterContract[] = [
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
  {
    source: "aipy",
    paths: [...USAGE_ADAPTER_PRESETS.aipy.paths],
    mapping: USAGE_ADAPTER_PRESETS.aipy.mapping,
    query: USAGE_ADAPTER_PRESETS.aipy.query,
    maxFileSizeBytes: 512 * 1024 * 1024,
    kind: "builtin",
  },
];

export const BUILTIN_USAGE_ADAPTERS: UsageAdapterContract[] = [
  ...REGISTRY_USAGE_ADAPTERS,
  ...LEGACY_USAGE_ADAPTERS,
];

export const GENERIC_BUILTIN_USAGE_ADAPTERS = BUILTIN_USAGE_ADAPTERS.filter(
  (adapter) => adapter.source !== "claude-code" && adapter.source !== "codex",
);
