/** Framework-neutral contracts for local AI execution.
 *
 * Provider adapters own network/SDK concerns. This module only accepts ports,
 * applies deterministic policy, and emits privacy-safe execution metadata.
 */
export type AIProviderId = string;
export type AIModelId = string;
export type PromptVersionId = string;

export type CostConfidence = "exact" | "estimated" | "unknown";

export interface PromptVersion {
  readonly id: PromptVersionId;
  readonly version: number;
  readonly label?: string;
  /** Template is private input and must never be copied into public telemetry. */
  readonly template: string;
}

export interface AIInput {
  readonly text: string;
  readonly variables?: Readonly<Record<string, unknown>>;
}

export interface AIRequest {
  readonly requestId: string;
  readonly providerId?: AIProviderId;
  readonly modelId: AIModelId;
  readonly prompt: PromptVersion;
  readonly input: AIInput;
  readonly budgetUsd?: number;
  /** Optional provider output-token ceiling; adapters keep their legacy default when omitted. */
  readonly maxOutputTokens?: number;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

export interface AIResponse {
  readonly modelId: AIModelId;
  readonly providerId: AIProviderId;
  readonly text: string;
  readonly usage?: TokenUsage;
  readonly finishReason?: "stop" | "length" | "cancelled" | "error";
}

export interface CostState {
  readonly confidence: CostConfidence;
  readonly amountUsd?: number;
  readonly currency: "USD";
  readonly reason: "priced" | "estimated" | "no-pricing" | "offline";
}

export type AIExecutionStatus =
  | "completed"
  | "offline"
  | "fallback"
  | "budget-exceeded"
  | "timeout"
  | "cancelled"
  | "failed";

/** Safe projection for logs, browser DTOs, and domain events. */
export interface AIExecutionSummary {
  readonly requestId: string;
  readonly modelId: AIModelId;
  readonly providerId?: AIProviderId;
  readonly promptVersionId: PromptVersionId;
  readonly promptVersion: number;
  readonly status: AIExecutionStatus;
  readonly cost: CostState;
  readonly usedFallback: boolean;
  readonly errorCode?: AIErrorCode;
}

export interface AIExecutionResult {
  readonly summary: AIExecutionSummary;
  /** Response is kept in the application boundary; summary is the public DTO. */
  readonly response?: AIResponse;
}

export type AIErrorCode =
  | "ai.budget-exceeded"
  | "ai.timeout"
  | "ai.cancelled"
  | "ai.provider-failed"
  | "ai.invalid-request";

export interface AIError {
  readonly code: AIErrorCode;
  readonly retryable: boolean;
}

export interface AIProviderRequest {
  readonly modelId: AIModelId;
  readonly prompt: PromptVersion;
  readonly input: AIInput;
  /** Optional output-token ceiling forwarded from the application request. */
  readonly maxOutputTokens?: number;
  readonly signal: AbortSignal;
}

export interface AIModelProvider {
  readonly providerId: AIProviderId;
  readonly invoke: (request: AIProviderRequest) => Promise<AIResponse>;
}

export interface ModelRouter {
  readonly route: (request: AIRequest) => AIModelProvider | undefined;
}

export interface PricingPort {
  estimate: (input: {
    readonly providerId: AIProviderId;
    readonly modelId: AIModelId;
    readonly usage?: TokenUsage;
  }) => CostState;
}

export interface AIOrchestrationPorts {
  readonly router?: ModelRouter;
  readonly pricing?: PricingPort;
  readonly now?: () => number;
  /** Deterministic, local fallback. Must not make I/O or network calls. */
  readonly offlineFallback?: (request: AIRequest) => AIResponse;
}
