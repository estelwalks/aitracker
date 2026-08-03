/**
 * Local AI-tool session records (Task D1, TrustTools V3.0 PRD v1.2).
 *
 * A `SessionRecord` is a privacy-preserving summary of one resumable session
 * from one of the three tools that expose a real session/resume concept:
 * Claude Code, Codex, and Grok (Grok Build). Only metadata is captured —
 * ids, timestamps, model, cwd, token totals, and turn counts. Conversation
 * content (prompts, responses, tool I/O) is never read or persisted.
 */

export type SessionSource = "claude-code" | "codex" | "grok";

export interface SessionTokenCounts {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

export interface SessionRecord {
  sessionId: string;
  source: SessionSource;
  title: string;
  /** basename of cwd — used as the project grouping key. */
  projectKey: string;
  /** raw cwd; the UI normalizes $HOME to ~/. */
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
  subagentCalls: number;
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

/** Filter shape accepted by `getLocalSessions`. */
export interface SessionFilter {
  source?: SessionSource;
  projectId?: string;
  range?: "all" | "7d" | "30d" | "90d";
  keyword?: string;
}
