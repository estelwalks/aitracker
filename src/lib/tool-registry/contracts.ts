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
 * at resolution time. `appData`/`appDataRoaming`/`configHome`/`dataHome` are
 * resolved per platform target (docs §6.1). Configs never hold absolute paths.
 */
export type PathBase =
  | "home"
  | "userProfile"
  | "appData"
  | "appDataRoaming"
  | "configHome"
  | "dataHome"
  | `env:${string}`;

export type UsageFormat = "json" | "jsonl" | "sqlite";

/** A usage log location, relative to the tool home. */
export interface UsagePathSpec {
  /** HOME-relative suffix (e.g. ".claude/projects"). */
  root: string;
  /** Glob selecting files under root. */
  glob: string;
  format: UsageFormat;
  /** v1.5 platform targets this path serves (the loader preserves them). */
  targets?: readonly PlatformTarget[];
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
  | "gemini-session-v1"
  | "grok-turn-v1"
  | "openclaw-session-v1"
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
  /** Independent context capability (docs §6) - never a UsageReader side effect. */
  context?: ContextCapability;
}

/** Skill discovery storage. Roots are HOME-relative suffixes; `[0]` is write path. */
export interface SkillStorage {
  roots: readonly string[];
  /** Env var whose non-empty value replaces the directory part of each root. */
  envHome?: string;
  markers?: readonly string[];
  maxDepth?: number;
  /** v1.5 platform-aware roots; the loader projects these into `roots`. */
  rootSpecs?: readonly SkillRootSpec[];
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
  /** v1.5 platform-aware locations; the loader projects these into `roots`. */
  locations?: readonly DetectionLocation[];
  /** v1.5 executable form (`{shared, windows}`); loader projects into `executable`. */
  executableSpec?: ExecutableSpec;
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

/**
 * Per-tool model observation (P1-1, renamed from the legacy `pricing` field):
 * how to extract the model name + billing evidence from the tool's logs.
 * Tools never hold rates, price packs or a fixed billing mode - billing
 * ownership moved to billing routes (docs §4, audit P1-1).
 */
export interface ToolModelObservation {
  /** Log field carrying the model name (default "model"). */
  modelField?: string;
  /** Normalization profile id (default "generic-normalize-v1"). */
  normalizeProfile?: string;
  /** Billing-evidence extraction: log field names per evidence kind. */
  evidence?: {
    providerField?: string;
    endpointField?: string;
    accountPlanField?: string;
    regionField?: string;
  };
  /** Usage-parsing semantics (not monetary pricing). */
  tokenSemantics?: {
    reasoningIncludedInOutput?: boolean;
    cacheWriteBillable?: boolean;
  };
}

export interface ToolDefinition {
  id: ToolId;
  configVersion: 1;
  /**
   * False only for legacy collection sources (aipy/cline) that must stay
   * compatible with usage scanning but are not part of the product catalog
   * (hidden from the public manifest, detection UI and market). Defaults to
   * true (docs §6: catalogVisible=false 仅用于遗留来源).
   */
  catalogVisible?: boolean;
  display: ToolDisplay;
  /** v1.5 per-platform availability; defaults to all-supported in the loader. */
  platforms?: ToolPlatforms;
  detection: ToolDetection;
  storage?: ToolStorage;
  capabilities: Capabilities;
  /** P1-1: model-observation projection (evidence extraction, never rates). */
  modelObservation?: ToolModelObservation;
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

// ---------------------------------------------------------------------------
// v1.5 superset types (Phase 3): platform-aware declarations compiled from
// definitions/*.tool.json. The old flattened fields above stay for consumers
// until Phase 4 switches them; the loader projects v1.5 forms into both.
// ---------------------------------------------------------------------------

/** Platform target used in locations and platform plans (docs §6.1). */
export type PlatformTarget = "macos" | "windows10" | "windows11" | "linux";
/** Platform group: `windows` = [windows10, windows11]. */
export type PlatformGroup = "windows";
export type PlatformStatus = "supported" | "planned" | "unsupported";

/**
 * Per-tool platform availability. `windows` is the group-level status; the
 * `windows10`/`windows11` keys are exact overrides (resolution priority:
 * shared default < platform group < platform target < tool definition).
 */
export interface ToolPlatforms {
  macos: PlatformStatus;
  windows?: PlatformStatus;
  windows10?: PlatformStatus;
  windows11?: PlatformStatus;
  linux: PlatformStatus;
}

/** A v1.5 platform-aware path declaration. `path` is relative to `base`. */
export interface DetectionLocation {
  targets: readonly PlatformTarget[];
  base: PathBase;
  path: string;
  glob?: string;
}

/** Executable names per platform family (v1.5). */
export interface ExecutableSpec {
  shared?: readonly string[];
  windows?: readonly string[];
}

/** v1.5 platform-aware skill root (`base` + `path`). */
export interface SkillRootSpec {
  base: PathBase;
  path: string;
}

/**
 * Independent context capability (docs §6): never an implicit UsageReader side
 * effect. `native` requires a registered ContextReader key; `heuristic` only
 * declares dimensions.
 */
export interface ContextCapability {
  mode: "native" | "heuristic" | "unsupported";
  /** ContextReader key; required when mode === "native". */
  reader?: string;
  /** Collected dimensions (tools/skills/commands/mcp/toolOutputs, ...). */
  dimensions?: readonly string[];
}
