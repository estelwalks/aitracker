import type {
  AIExecutionResult,
  AIExecutionSummary,
  AIRequest,
} from "../ai-orchestration/contracts.ts";
import type {
  KnowledgeRepository,
  KnowledgeVersion,
} from "../knowledge/contracts.ts";
import type {
  SessionQueryPort,
  SessionSummary,
  SessionTranscript,
} from "../sessions/contracts.ts";
import type { Result } from "../../shared/result.ts";
import type { DistillQuotaPort } from "./quota.ts";

export const distillationModuleId = "distillation" as const;
export type DistillationModuleId = typeof distillationModuleId;

export type DistillationErrorCode =
  | "errors.distillation.invalidSelection"
  | "errors.distillation.sessionNotFound"
  | "errors.distillation.cancelled"
  | "errors.distillation.notFound"
  | "errors.distillation.notWaiting"
  | "errors.distillation.knowledgeUnavailable"
  | "errors.distillation.knowledgeFailed"
  | "errors.distillation.notApproved"
  | "errors.distillation.invalidName"
  | "errors.distillation.invalidAgent"
  | "errors.distillation.skillExists"
  | "errors.distillation.quotaExceeded"
  | "errors.distillation.noModelConfigured"
  | "errors.distillation.aiFailed";

export type ApprovalState = "waiting-approval" | "approved" | "cancelled";
export type DistillationMode =
  "model" | "offline" | "fallback" | "budget-exceeded";

/** Durable progress phases shared by every distillation output kind. */
export type DistillationTaskPhase =
  | "queued"
  | "reading-material"
  | "generating"
  | "quality-check"
  | "persisting-candidate"
  | "syncing-target"
  | "completed"
  | "failed"
  | "cancelled";

export interface DistillationTaskProgress {
  readonly taskId: string;
  readonly phase: DistillationTaskPhase;
  /** 0–100; 100 is emitted only after candidate persistence completes. */
  readonly percent: number;
  readonly kind: CandidateOutput["kind"];
  readonly candidateId?: string;
  readonly candidate?: CandidateOutput;
  readonly errorCode?: DistillationErrorCode;
  readonly updatedAt: string;
}

/** An opaque reference; it is never a filesystem path or an external command. */
export interface SessionRef {
  readonly source: string;
  readonly sessionId: string;
}

/**
 * Inclusive message-index window into one session's transcript (0-based).
 * Only the user explicitly selected segment is ever read into memory; the
 * referenced text goes into the AI request and is never persisted.
 */
export interface SegmentRef {
  readonly source: string;
  readonly sessionId: string;
  /** First message index (0-based, inclusive). */
  readonly startIndex: number;
  /** Last message index (0-based, inclusive). */
  readonly endIndex: number;
}

/**
 * In-memory material extracted from a user-selected transcript segment.
 * Exists only for the current AI request; never persisted, never uploaded.
 */
export interface SegmentMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
}

export interface SegmentMaterial {
  readonly source: string;
  readonly sessionId: string;
  /** Optional session title attached from the controlled metadata context. */
  readonly title?: string;
  readonly messages: readonly SegmentMessage[];
}

export interface SessionSelection {
  readonly sessionRefs: readonly SessionRef[];
  /**
   * Optional user-selected transcript segments (Story B-100). When present,
   * the referenced sessions must also be in `sessionRefs`; the segment window
   * marks which messages of that session feed the distillation input.
   */
  readonly segments?: readonly SegmentRef[];
}

export interface DistillationRequest {
  readonly requestId: string;
  readonly selection: SessionSelection;
  readonly modelId: string;
  readonly prompt: AIRequest["prompt"];
  /**
   * Optional provider routing hint. The transport sets `"profile"` when
   * `modelId` is a saved S-500 model profile, so the composition root's
   * profile-backed provider performs the real call; absent → the offline
   * registry route.
   */
  readonly providerId?: string;
  /**
   * Output kind the run should produce (prototype output: skill/workflow/prompt
   * into the capability group, profile/task into memory). Absent → "memory".
   */
  readonly kind?: CandidateOutput["kind"];
  readonly budgetUsd?: number;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

/** Deliberately excludes token totals, content, commands and source paths. */
export interface ControlledSessionSummary {
  readonly ref: SessionRef;
  readonly title: string;
  readonly projectKey: string;
  readonly model: string | null;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly turns: number;
  readonly editTurns: number;
  readonly retryTurns: number;
  readonly subagentCalls: number;
  readonly status: SessionSummary["status"];
}

export interface CandidateOutput {
  readonly candidateId: string;
  readonly kind: "memory" | "brief" | "prompt" | "persona" | "skill";
  readonly title: string;
  /**
   * Safety-filtered knowledge note produced by the AI execution. It is the
   * only textual payload that may be persisted with the candidate — it is
   * generated from sanitised session metadata, never raw conversation content.
   */
  readonly summary: string;
  readonly mode: DistillationMode;
  readonly approvalState: ApprovalState;
  readonly selectedSessionRefs: readonly SessionRef[];
  readonly generatedAt: string;
  /**
   * The corresponding knowledge asset id after approval (memory asset → memory database entry). Written and persisted on approval,
   * Used to jump back to the memory bank from a candidate card. If the capability asset (brief/skill/prompt) is not in the knowledge base, it will be empty.
   */
  readonly knowledgeAssetId?: string;
  readonly execution: AIExecutionSummary;
}

export interface DistillationResult {
  readonly requestId: string;
  readonly status: ApprovalState;
  readonly candidate?: CandidateOutput;
  readonly knowledgeVersion?: KnowledgeVersion;
  readonly execution?: AIExecutionSummary;
}

export interface AIOrchestrationPort {
  execute(request: AIRequest): Promise<AIExecutionResult>;
}

/**
 * Durable store for distillation candidates. When injected, candidates are
 * hydrated on application construction and every start/approve/cancel writes
 * through. When absent the application degrades to the previous in-memory
 * behaviour.
 */
export interface CandidatePersistence {
  /** Enumerate all persisted candidates (newest first). */
  list(): Promise<readonly CandidateOutput[]>;
  /** Upsert a candidate by id. */
  save(candidate: CandidateOutput): Promise<void>;
  delete?(candidateId: string): Promise<void>;
}

export interface DistillationPorts {
  readonly sessions: SessionQueryPort;
  readonly ai: AIOrchestrationPort;
  /**
   * Optional transcript reader for user-selected message segments. It is the
   * ONLY distillation path that ever touches conversation text: invoked per
   * explicitly selected `SegmentRef`, held in memory for the current AI
   * request, and never persisted or uploaded (Story B-100). A failed read
   * degrades that segment away — distillation never fails on transcripts.
   */
  readonly transcriptPort?: {
    load(ref: SessionRef): Promise<SessionTranscript | null>;
  };
  /** Only used after explicit approval; never during candidate generation. */
  readonly knowledge?: KnowledgeRepository;
  /** Optional durable candidate store; degrades to in-memory when absent. */
  readonly persistence?: CandidatePersistence;
  /**
   * Optional server-side daily quota ledger for real-model calls (Story B-600).
   * When present, `start` atomically reserves one call against today's quota
   * before invoking the model (P2-10) — the reservation both checks the limit
   * and counts the call in a single ledger write, so concurrent starts can
   * never overshoot the daily ceiling. Offline runs never touch it; a missing
   * or failing quota port degrades to unlimited so distillation is never
   * blocked by quota bookkeeping itself.
   */
  readonly quota?: DistillQuotaPort;
  readonly now?: () => Date;
  readonly createCandidateId?: () => string;
}

export interface DistillationApplication {
  start(
    request: DistillationRequest,
  ): Promise<Result<DistillationResult, DistillationErrorCode>>;
  approve(
    candidateId: string,
    actor: string,
  ): Promise<Result<DistillationResult, DistillationErrorCode>>;
  cancel(
    candidateId: string,
  ): Promise<Result<DistillationResult, DistillationErrorCode>>;
  /**
   * Number of persisted knowledge assets produced by distillation (approved
   * candidates), or null when the knowledge repository is unavailable.
   */
  count(): Promise<number | null>;
  /**
   * Distilled asset counts by type: capability assets (skills etc., every
   * non-memory knowledge kind) vs memory assets. Null when the knowledge
   * repository is unavailable.
   */
  counts(): Promise<DistillationAssetCounts>;
  /** Enumerate candidates awaiting approval (newest first). */
  listWaiting(): Promise<CandidateOutput[]>;
  /** Enumerate all persisted candidates across approval states (newest first). */
  listAll(): Promise<CandidateOutput[]>;
  /**
   * Fetch a single candidate by id regardless of approval state. Used by the
   * save-as-skill flow to verify a candidate is genuinely approved before
   * writing it as a local Skill.
   */
  get(candidateId: string): Promise<CandidateOutput | undefined>;
  delete(candidateId: string): Promise<boolean>;
}

export interface DistillationAssetCounts {
  /** Capability assets: skill distillation products (knowledge base kind, not memory). */
  readonly capability: number | null;
  /** Memory asset: knowledge base kind = memory. */
  readonly memory: number | null;
}

export interface DistillationModuleContract {
  readonly module: DistillationModuleId;
  readonly schemaVersion: 1;
}
