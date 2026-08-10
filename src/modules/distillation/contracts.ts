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

export const distillationModuleId = "distillation" as const;
export type DistillationModuleId = typeof distillationModuleId;

export type DistillationErrorCode =
  | "errors.distillation.invalidSelection"
  | "errors.distillation.sessionNotFound"
  | "errors.distillation.cancelled"
  | "errors.distillation.notFound"
  | "errors.distillation.notWaiting"
  | "errors.distillation.knowledgeUnavailable"
  | "errors.distillation.knowledgeFailed";

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
  /** Ephemeral, safety-filtered candidate text. It is not persisted by this module. */
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

export interface DistillationPorts {
  readonly sessions: SessionQueryPort;
  readonly ai: AIOrchestrationPort;
  /** Only used after explicit approval; never during candidate generation. */
  readonly knowledge?: KnowledgeRepository;
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
}

export interface DistillationModuleContract {
  readonly module: DistillationModuleId;
  readonly schemaVersion: 1;
}
