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
} from "../sessions/contracts.ts";
import type { Result } from "../../shared/result.ts";
import type { DistillQuota } from "./quota.ts";

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
  | "errors.distillation.quotaExceeded";

export type ApprovalState = "waiting-approval" | "approved" | "cancelled";
export type DistillationMode =
  "model" | "offline" | "fallback" | "budget-exceeded";

/** An opaque reference; it is never a filesystem path or an external command. */
export interface SessionRef {
  readonly source: string;
  readonly sessionId: string;
}

export interface SessionSelection {
  readonly sessionRefs: readonly SessionRef[];
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
}

export interface DistillationPorts {
  readonly sessions: SessionQueryPort;
  readonly ai: AIOrchestrationPort;
  /** Only used after explicit approval; never during candidate generation. */
  readonly knowledge?: KnowledgeRepository;
  /** Optional durable candidate store; degrades to in-memory when absent. */
  readonly persistence?: CandidatePersistence;
  /**
   * Optional server-side daily quota ledger for real-model calls (Story B-600).
   * When present, `start` rejects a real-model request that has exhausted
   * today's quota and records one usage after a successful run. Offline runs
   * never touch it; a missing or failing quota port degrades to unlimited so
   * distillation is never blocked by quota bookkeeping itself.
   */
  readonly quota?: {
    read(): Promise<DistillQuota>;
    increment(date: string): Promise<DistillQuota>;
  };
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
}

export interface DistillationModuleContract {
  readonly module: DistillationModuleId;
  readonly schemaVersion: 1;
}
