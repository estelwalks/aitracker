import { PUBLIC_TOOL_MANIFEST } from "../tool-registry/public-manifest.generated.ts";

/**
 * The known usage source ids (F6-T2).
 *
 * Projected from the browser-safe public manifest — the single authority for
 * the source universe: every catalog tool id, plus the ids of legacy-marked
 * tools (`legacy: true`, stamped by `generatePublicManifest` from
 * `LEGACY_TOOL_IDS` in the tool-registry). Deduped because legacy sources
 * (aipy/cline) are also catalog-visible today. No source ids are hardcoded in
 * this module; a tool that leaves the catalog but keeps `legacy` stays
 * scannable, and one that fully disappears from the registry drops out.
 */
const MANIFEST_TOOL_IDS: readonly string[] = PUBLIC_TOOL_MANIFEST.tools.map(
  (tool) => tool.id,
);
const LEGACY_TOOL_IDS: readonly string[] = PUBLIC_TOOL_MANIFEST.tools
  .filter((tool) => tool.legacy === true)
  .map((tool) => tool.id);

export const KNOWN_LOCAL_USAGE_SOURCES = [
  ...new Set([...MANIFEST_TOOL_IDS, ...LEGACY_TOOL_IDS]),
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

/**
 * Whether a token count came directly from a tool usage record or from a
 * documented local estimate. Estimated values are kept separate from context
 * attribution: a transcript-size estimate cannot prove where tokens went.
 */
export type LocalUsageMeasurement = "observed" | "estimated";

export interface LocalUsageEvent extends LocalTokenCounts {
  source: LocalUsageSource;
  timestamp: string;
  model: string;
  project: string;
  sessionId?: string;
  context?: LocalUsageContext;
  /** Omitted by older/native readers; omission means directly observed. */
  measurement?: LocalUsageMeasurement;
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
  /**
   * Display-safe project label (final path segment) when the breakdown key is
   * an opaque ref hash (P2-1): consumers must render `label ?? key` so a
   * hydrated snapshot never shows a base64url hash as a project name.
   */
  label?: string;
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
