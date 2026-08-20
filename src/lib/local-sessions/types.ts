/**
 * Local AI-tool session records (Task D1, V3.0 PRD v1.2).
 *
 * A `SessionRecord` is a privacy-preserving summary of one resumable session
 * from one of the registry-declared session tools (currently Claude Code,
 * Codex, Grok Build, and DeepSeek Harness). Only metadata is captured — ids,
 * timestamps, model, cwd, token totals, and turn counts. Conversation content
 * (prompts, responses, tool I/O) is never read or persisted.
 */

/**
 * Compile-time mirror of the tool registry's `sessions.mode = "resume"` tool
 * ids (P1-3). The runtime source of truth is `listSessionTools()` in
 * server-fns.ts; parity between the two is asserted by resume-id.test.ts. The
 * `(string & {})` branch keeps the type open for future tools while still
 * allowing exhaustiveness where needed (same pattern as `UsageReaderKey`).
 */
export const SESSION_TOOL_IDS = [
  "claude-code",
  "codex",
  "grok",
  "dsh",
] as const;

export type SessionSource = (typeof SESSION_TOOL_IDS)[number] | (string & {});

/**
 * State derived exclusively from explicit local session metadata.  `available`
 * is not a claim that a remote provider still retains the conversation: it
 * only means this local record has a shell-safe resume id.  `unavailable`
 * keeps malformed ids visible without ever constructing a command for them.
 */
export type SessionStatus =
  "available" | "interrupted" | "lost" | "unavailable";

export interface SessionTokenCounts {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

/**
 * A pricing result preserving the four pricing states (audit P1-1); mirrors
 * `pricing/index.ts` CostEstimate. Unknown models or unsupported cache-write
 * pricing stay explicit; estimated amounts are a separate subtotal.
 */
export interface SessionCostEstimate {
  knownUsd: number;
  estimatedUsd: number;
  cacheSavingsUsd: number;
  pricedEvents: number;
  estimatedEvents: number;
  unknownEvents: number;
  unknownModels: string[];
  complete: boolean;
}

export interface SessionRecord {
  sessionId: string;
  source: SessionSource;
  title: string;
  /** basename of cwd — used as the project grouping key. */
  projectKey: string;
  /** cwd normalized like usage events (~/… under HOME); used to join sessions to usage project rows. */
  projectRef: string;
  model: string | null;
  /** ISO timestamp of the earliest record. */
  startedAt: string;
  /** ISO timestamp of the latest record. */
  endedAt: string;
  /** ACTIVE time — sum of inter-record gaps ≤ IDLE_GAP_MS, not wall-clock. */
  durationMs: number;
  /** user-turn count. */
  turns: number;
  /** user turns that contained an edit tool (best-effort; 0 if unknown). */
  editTurns: number;
  /** retried user turns (best-effort; 0 if unknown in v1). */
  retryTurns: number;
  totals: SessionTokenCounts;
  /** Estimate using the same local model-price catalog as the Token dashboard. */
  cost: SessionCostEstimate;
  subagentCalls: number;
  /** Local metadata state; never inferred from missing logs or conversation text. */
  status: SessionStatus;
  /** Short explanation of the exact metadata evidence behind a non-default state. */
  statusReason: string | null;
  /** true iff sessionId matches the shell-safe alphabet. */
  resumeSafe: boolean;
  /** Bare resume command (e.g. "claude --resume <id>"); null if !resumeSafe. */
  resumeCommand: string | null;
}

export interface SessionSummary {
  generatedAt: string;
  sessions: SessionRecord[];
  total: number;
}

/** Filter shape used by the sessions query service. */
export interface SessionFilter {
  source?: SessionSource;
  projectId?: string;
  range?: "all" | "7d" | "30d" | "90d";
  keyword?: string;
  status?: SessionStatus;
}
