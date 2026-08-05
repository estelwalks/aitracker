/**
 * Tool-registry domain contracts.
 *
 * Pure types only - zero runtime, zero imports. Importable anywhere (browser
 * included). A `ToolDefinition` is pure data: it must NOT contain I/O, network,
 * environment reads, parser code, or `matches()` functions. Specialized parsing
 * lives behind a stable `ReaderKey` that a controlled factory maps to an
 * implementation (see readers/).
 */

/** Stable lowercase-kebab identifier; never reused across tools. */
export type ToolId = string;

/**
 * Controlled anchor for a path base. `home` is the user home directory; an
 * `env:NAME` base is replaced by the value of env var `NAME` (when non-empty)
 * at resolution time. Configs never hold absolute paths.
 */
export type PathBase = "home" | `env:${string}`;

export type UsageFormat = "json" | "jsonl" | "sqlite";

/** A usage log location, relative to the tool home. */
export interface UsagePathSpec {
  /** HOME-relative suffix (e.g. ".claude/projects"). */
  root: string;
  /** Glob selecting files under root. */
  glob: string;
  format: UsageFormat;
}

/**
 * Declarative field mapping for generic readers (data, not code). Each field
 * lists candidate JSON keys tried in order.
 */
export interface UsageFieldMapping {
  records?: readonly string[];
  timestamp?: readonly string[];
  sessionId?: readonly string[];
  model?: readonly string[];
  project?: readonly string[];
  inputTokens?: readonly string[];
  cachedInputTokens?: readonly string[];
  cacheCreationInputTokens?: readonly string[];
  outputTokens?: readonly string[];
  reasoningOutputTokens?: readonly string[];
  totalTokens?: readonly string[];
}

/**
 * ReaderKey identifies a controlled parser implementation. The literal union
 * enumerates built-in keys; the `(string & {})` branch keeps the type open for
 * future built-ins while still allowing exhaustiveness where needed. Unknown
 * keys are rejected at compile/validate time.
 */
export type UsageReaderKey =
  | "generic-json"
  | "generic-jsonl"
  | "generic-sqlite"
  | "claude-rollout-v1"
  | "codex-rollout-v1"
  | (string & {});

export type SessionReaderKey =
  "claude-session-v1" | "codex-session-v1" | "grok-session-v1" | (string & {});

export interface UsageCapability {
  mode: "native" | "adapter" | "unsupported";
  /** Required when mode !== "unsupported". */
  reader?: UsageReaderKey;
  /** Required when mode !== "unsupported". */
  paths?: readonly UsagePathSpec[];
  /** Adapter-mode field mapping (generic readers). */
  mapping?: UsageFieldMapping;
  maxFileSizeBytes?: number;
  /** SQL query for sqlite readers (data only). */
  query?: string;
}

export interface SkillsCapability {
  mode: "read-write" | "read" | "unsupported";
}

/**
 * Agent directory capability. Per architecture audit P2, agent file formats are
 * unverified, so `write` is intentionally absent this milestone.
 */
export interface AgentsCapability {
  mode: "read" | "unsupported";
}

export interface SessionsCapability {
  mode: "resume" | "unsupported";
  /** Required when mode === "resume". */
  reader?: SessionReaderKey;
  /**
   * Resume command as a token array template. Must contain a `{sessionId}`
   * placeholder token (never string-interpolated; the UI only copies). The
   * session id is separately validated before substitution.
   */
  command?: readonly string[];
}

export interface MarketCapability {
  mode: "install-target" | "unsupported";
}

export interface SecurityCapability {
  mode: "scan" | "unsupported";
}

export interface Capabilities {
  usage: UsageCapability;
  skills: SkillsCapability;
  agents: AgentsCapability;
  sessions: SessionsCapability;
  market: MarketCapability;
  security: SecurityCapability;
}

/** Skill discovery storage. Roots are HOME-relative suffixes; `[0]` is write path. */
export interface SkillStorage {
  roots: readonly string[];
  /** Env var whose non-empty value replaces the directory part of each root. */
  envHome?: string;
  markers?: readonly string[];
  maxDepth?: number;
}

export interface AgentStorage {
  roots: readonly string[];
  mode: "read" | "unsupported";
}

export interface ToolStorage {
  dataRoots?: readonly { base: PathBase; path: string }[];
  skills?: SkillStorage;
  agents?: AgentStorage;
}

export interface ToolDisplay {
  name: string;
  nameZh: string;
  icon?: string;
}

export interface ToolDetection {
  /** HOME-relative probe paths used to detect installation. */
  roots: readonly string[];
  executable?: readonly string[];
}

/** Declarative model matcher (data, not a function). */
export type ModelMatcher =
  | { kind: "exactOrSnapshot"; names: readonly string[] }
  | { kind: "includesAll"; parts: readonly string[] };

export interface ModelRateTier {
  maxInputTokens: number | null;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cacheReadUsdPerMillion: number;
}

export interface ModelRateRule {
  id: string;
  label: string;
  effectiveFrom: string;
  effectiveTo?: string;
  priority?: number;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cacheReadUsdPerMillion: number;
  cacheWriteUsdPerMillion: number | null;
  tiers?: readonly ModelRateTier[];
  match: ModelMatcher;
}

export interface ToolPricing {
  provider: string;
  rules: readonly ModelRateRule[];
}

export interface ToolDefinition {
  id: ToolId;
  configVersion: 1;
  display: ToolDisplay;
  detection: ToolDetection;
  storage?: ToolStorage;
  capabilities: Capabilities;
  pricing?: ToolPricing;
}

/** Normalized model id used for matching: trim + lowercase + `_`/`.` -> `-`. */
export function normalizeModel(model: string): string {
  return model.trim().toLowerCase().replaceAll("_", "-").replaceAll(".", "-");
}

/** Evaluate a declarative matcher against an already-normalized model. */
export function matchModel(
  matcher: ModelMatcher,
  normalizedModel: string,
): boolean {
  if (matcher.kind === "exactOrSnapshot") {
    return matcher.names.some((name) => {
      const n = normalizeModel(name);
      return normalizedModel === n || normalizedModel.startsWith(`${n}-20`);
    });
  }
  return matcher.parts.every((part) => normalizedModel.includes(part));
}
