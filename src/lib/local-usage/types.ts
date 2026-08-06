import { PUBLIC_TOOL_MANIFEST } from "../tool-registry/public-manifest.generated.ts";

/**
 * The known usage source ids.
 *
 * The primary set is the 27 PRD v1.2 tools, derived from `AI_TOOL_IDS` (the
 * single source of truth in `src/lib/tools/catalog.ts`). Two legacy adapter
 * source ids (`aipy`, `cline`) are retained on top of the PRD list because the
 * builtin usage adapters in `adapters/catalog.ts` and their golden fixtures
 * still reference them — see BUILTIN_USAGE_ADAPTERS. `windsurf`/`qoder` etc.
 * are intentionally NOT included; they were never wired to an adapter.
 */
const LEGACY_ADAPTER_SOURCES = ["aipy", "cline"] as const;

export const KNOWN_LOCAL_USAGE_SOURCES = [
  ...PUBLIC_TOOL_MANIFEST.tools.map((tool) => tool.id),
  ...LEGACY_ADAPTER_SOURCES,
] as const;

export type KnownLocalUsageSource = (typeof KNOWN_LOCAL_USAGE_SOURCES)[number];
export type LocalUsageSource = KnownLocalUsageSource;

export type LocalUsageDiagnosticCode =
  | "config-invalid"
  | "file-too-large"
  | "field-mismatch"
  | "malformed-json"
  | "query-failed"
  | "read-failed";

export interface LocalUsageDiagnostic {
  code: LocalUsageDiagnosticCode;
  source: LocalUsageSource;
  path?: string;
  count: number;
  message: string;
}

export interface LocalTokenCounts {
  inputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

export const LOCAL_USAGE_TOOL_CATEGORIES = [
  "messages",
  "execution",
  "planning",
  "agent",
  "browser",
  "mcp",
  "skills",
  "other",
] as const;

export type LocalUsageToolCategory =
  (typeof LOCAL_USAGE_TOOL_CATEGORIES)[number];

export interface LocalUsageToolCall {
  name: string;
  category: LocalUsageToolCategory;
  calls: number;
}

export interface LocalUsageSkillCall {
  name: string;
  calls: number;
}

export type LocalUsageCommandDurationBucket =
  "under-1s" | "1s-10s" | "10s-60s" | "over-60s" | "unknown";

export type LocalUsageCommandOutputSizeBucket =
  "empty" | "under-1k" | "1k-10k" | "over-10k" | "unknown";

export type LocalUsageCommandExitStatus =
  "success" | "failure" | "interrupted" | "unknown";

export interface LocalUsageCommandStat {
  kind: "exec_command";
  executable: string;
  safeSignature: string;
  duration: LocalUsageCommandDurationBucket;
  outputSize: LocalUsageCommandOutputSizeBucket;
  exitStatus: LocalUsageCommandExitStatus;
  calls: number;
}

export interface LocalUsageToolOutputSummary {
  characters: number;
  lines: number;
  completed: boolean;
  calls: number;
}

/** A privacy-preserving summary of the Codex activity preceding this token count. */
export interface LocalUsageContext {
  textResponse?: boolean;
  tools?: LocalUsageToolCall[];
  skills?: LocalUsageSkillCall[];
  commands?: LocalUsageCommandStat[];
  toolOutputs?: LocalUsageToolOutputSummary;
}

export interface LocalUsageEvent extends LocalTokenCounts {
  source: LocalUsageSource;
  timestamp: string;
  model: string;
  project: string;
  sessionId?: string;
  context?: LocalUsageContext;
}

export interface LocalUsageSourceSummary {
  source: LocalUsageSource;
  available: boolean;
  detected?: boolean;
  paths?: string[];
  filesConsidered: number;
  filesRead: number;
  filesReused: number;
  filesParsed: number;
  malformedLines: number;
  events: number;
  diagnostics?: LocalUsageDiagnostic[];
}

export interface LocalUsageTotals extends LocalTokenCounts {
  events: number;
}

export interface LocalUsageBreakdown extends LocalUsageTotals {
  key: string;
}

export interface LocalUsageDaily extends LocalUsageTotals {
  date: string;
  bySource: Record<string, LocalTokenCounts>;
}

export interface LocalUsageSnapshot {
  generatedAt: string;
  mode: "real" | "empty";
  sources: LocalUsageSourceSummary[];
  events: number;
  totals: LocalUsageTotals;
  bySource: LocalUsageBreakdown[];
  byModel: LocalUsageBreakdown[];
  byProject: LocalUsageBreakdown[];
  daily: LocalUsageDaily[];
  details: LocalUsageEvent[];
  recent: LocalUsageEvent[];
}
