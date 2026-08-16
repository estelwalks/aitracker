import type { Result } from "../../shared/result.ts";

export const sessionsModuleId = "sessions" as const;
export type SessionsModuleId = typeof sessionsModuleId;

export type SessionSource = string;
export type SessionStatus =
  "available" | "interrupted" | "lost" | "unavailable";

export interface SessionTokenTotals {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly reasoningOutputTokens: number;
  readonly totalTokens: number;
}

export interface SessionCostSummary {
  readonly knownUsd: number;
  readonly estimatedUsd: number;
  readonly cacheSavingsUsd: number;
  readonly pricedEvents: number;
  readonly estimatedEvents: number;
  readonly unknownEvents: number;
  readonly unknownModels: readonly string[];
  readonly complete: boolean;
}

/** Browser-safe session projection. Never add paths, commands, or content. */
export interface SessionSummary {
  readonly sessionId: string;
  readonly source: SessionSource;
  readonly title: string;
  /** Stable basename/group key; this is not a filesystem path. */
  readonly projectKey: string;
  readonly model: string | null;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationMs: number;
  readonly turns: number;
  readonly editTurns: number;
  readonly retryTurns: number;
  readonly totals: SessionTokenTotals;
  readonly cost: SessionCostSummary;
  readonly subagentCalls: number;
  readonly status: SessionStatus;
  readonly statusReason: string | null;
  readonly resumeAvailable: boolean;
}

export interface SessionFilter {
  readonly source?: SessionSource;
  readonly projectId?: string;
  readonly range?: "all" | "7d" | "30d" | "90d";
  readonly keyword?: string;
  readonly status?: SessionStatus;
}

export type SessionSortField =
  "startedAt" | "endedAt" | "durationMs" | "totalTokens";
export type SessionSortDirection = "asc" | "desc";

export interface SessionPageRequest {
  readonly filter?: SessionFilter;
  readonly page?: number;
  readonly pageSize?: number;
  readonly sort?: {
    readonly field: SessionSortField;
    readonly direction: SessionSortDirection;
  };
  readonly signal?: AbortSignal;
}

export interface SessionPage {
  readonly generatedAt: string;
  readonly sessions: readonly SessionSummary[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
}

/**
 * Transcript contract (Story S-300) — deliberately independent of
 * `SessionSummary`, which stays a content-free browser-safe projection.
 * A transcript is read from the user's own local logs, held in memory only,
 * serialized into the current page response, and never persisted or uploaded.
 */
export interface SessionTranscriptMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  /** Reasoning / thinking block; may be absent. */
  readonly thinking?: string;
}

export interface SessionTranscript {
  readonly sessionId: string;
  readonly source: SessionSource;
  readonly messages: readonly SessionTranscriptMessage[];
}

export interface SessionRepository {
  list(signal?: AbortSignal): Promise<readonly SessionSummary[]>;
}

export interface SessionQueryPort {
  query(request?: SessionPageRequest): Promise<Result<SessionPage>>;
}

export interface ResumeSessionRequest {
  readonly source: SessionSource;
  readonly sessionId: string;
  readonly signal?: AbortSignal;
}

export type ResumeSessionErrorCode =
  | "errors.sessions.resumeUnavailable"
  | "errors.sessions.resumeInvalid"
  | "errors.sessions.resumeCancelled"
  | "errors.sessions.resumeFailed";

export interface ResumeSessionResult {
  readonly accepted: boolean;
  readonly source: SessionSource;
  readonly sessionId: string;
}

export interface ResumeSessionPort {
  resume(
    request: ResumeSessionRequest,
  ): Promise<Result<ResumeSessionResult, ResumeSessionErrorCode>>;
}

export interface SessionsModuleContract {
  readonly module: SessionsModuleId;
  readonly schemaVersion: 1;
}
