import type {
  AIError,
  AIExecutionResult,
  AIExecutionStatus,
  AIRequest,
  AIResponse,
  AIOrchestrationPorts,
  CostState,
  TokenUsage,
} from "./contracts.ts";

const UNKNOWN_COST: CostState = {
  confidence: "unknown",
  currency: "USD",
  reason: "no-pricing",
};
const OFFLINE_COST: CostState = {
  confidence: "unknown",
  currency: "USD",
  reason: "offline",
};

function fallbackResponse(request: AIRequest): AIResponse {
  return {
    providerId: "offline",
    modelId: request.modelId,
    text: "Offline deterministic fallback: model execution was not available.",
    finishReason: "stop",
  };
}

function errorFor(status: AIExecutionStatus): AIError | undefined {
  if (status === "budget-exceeded")
    return { code: "ai.budget-exceeded", retryable: false };
  if (status === "timeout") return { code: "ai.timeout", retryable: true };
  if (status === "cancelled") return { code: "ai.cancelled", retryable: false };
  if (status === "failed")
    return { code: "ai.provider-failed", retryable: true };
  if (status === "fallback")
    return { code: "ai.provider-failed", retryable: true };
  return undefined;
}

const SAFE_PROVIDER_ERROR_CODES = new Set<AIError["code"]>([
  "ai.provider-auth",
  "ai.provider-rate-limited",
  "ai.provider-unavailable",
  "ai.provider-http-client",
  "ai.provider-network",
  "ai.provider-invalid-response",
  "ai.profile-unavailable",
]);

function safeProviderErrorCode(error: unknown): AIError["code"] {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (
      typeof code === "string" &&
      SAFE_PROVIDER_ERROR_CODES.has(code as AIError["code"])
    ) {
      return code as AIError["code"];
    }
  }
  if (error instanceof TypeError) return "ai.provider-network";
  return "ai.provider-failed";
}

/**
 * Provider errors may carry a sanitized, bounded attribution string
 * (`detail`). It is our own classification text (never raw provider output),
 * but keep a defensive length/safety bound before it reaches telemetry.
 */
function extractProviderFailureDetail(error: unknown): string | undefined {
  if (error && typeof error === "object" && "detail" in error) {
    const detail = (error as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.length > 0) {
      return detail.replace(/[\r\n]/gu, " ").slice(0, 200);
    }
  }
  return undefined;
}

function costFor(
  ports: AIOrchestrationPorts,
  response: AIResponse | undefined,
  request: AIRequest,
): CostState {
  if (!response) return UNKNOWN_COST;
  if (response.providerId === "offline") return OFFLINE_COST;
  return (
    ports.pricing?.estimate({
      providerId: response.providerId,
      modelId: response.modelId,
      usage: response.usage,
    }) ?? UNKNOWN_COST
  );
}

function estimatedBudget(
  ports: AIOrchestrationPorts,
  request: AIRequest,
): CostState {
  const provider = ports.router?.route(request);
  if (!provider || !ports.pricing) return UNKNOWN_COST;
  return ports.pricing.estimate({
    providerId: provider.providerId,
    modelId: request.modelId,
  });
}

function withTimeout(
  promise: Promise<AIResponse>,
  signal: AbortSignal,
  timeoutMs: number,
  onTimeout?: () => void,
): Promise<AIResponse> {
  if (timeoutMs <= 0) return Promise.reject(new Error("timeout"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      // Abort the underlying provider request so a timed-out call stops
      // consuming gateway resources instead of running in the background.
      onTimeout?.();
      reject(new Error("timeout"));
    }, timeoutMs);
    const abort = () => {
      clearTimeout(timer);
      reject(new Error("cancelled"));
    };
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

export async function executeAIRequest(
  request: AIRequest,
  ports: AIOrchestrationPorts = {},
): Promise<AIExecutionResult> {
  const started = ports.now?.() ?? Date.now();
  const provider = ports.router?.route(request);
  const estimate = estimatedBudget(ports, request);
  if (
    request.budgetUsd !== undefined &&
    estimate.amountUsd !== undefined &&
    estimate.amountUsd > request.budgetUsd
  ) {
    return result(request, "budget-exceeded", undefined, estimate);
  }

  const controller = new AbortController();
  const signal = request.signal
    ? AbortSignal.any([request.signal, controller.signal])
    : controller.signal;
  const timeoutMs = request.timeoutMs ?? 30_000;
  let response: AIResponse;
  let status: AIExecutionStatus = provider ? "completed" : "offline";
  let providerErrorCode: AIError["code"] | undefined;
  let failureDetail: string | undefined;
  try {
    response = provider
      ? await withTimeout(
          provider.invoke({
            modelId: request.modelId,
            prompt: request.prompt,
            input: request.input,
            maxOutputTokens: request.maxOutputTokens,
            signal,
          }),
          signal,
          timeoutMs,
          () => controller.abort(),
        )
      : (ports.offlineFallback?.(request) ?? fallbackResponse(request));
  } catch (error) {
    if (
      signal.aborted ||
      (error instanceof Error && error.message === "cancelled")
    ) {
      status = request.signal?.aborted ? "cancelled" : "timeout";
    } else if (error instanceof Error && error.message === "timeout") {
      status = "timeout";
    } else {
      status = "fallback";
      providerErrorCode = safeProviderErrorCode(error);
      failureDetail = extractProviderFailureDetail(error);
    }
    response = ports.offlineFallback?.(request) ?? fallbackResponse(request);
  }
  const elapsed = (ports.now?.() ?? Date.now()) - started;
  void elapsed;
  return result(
    request,
    status,
    response,
    costFor(ports, response, request),
    providerErrorCode,
    failureDetail,
  );
}

function result(
  request: AIRequest,
  status: AIExecutionStatus,
  response: AIResponse | undefined,
  cost: CostState,
  providerErrorCode?: AIError["code"],
  failureDetail?: string,
): AIExecutionResult {
  const failure = errorFor(status);
  return {
    response,
    summary: {
      requestId: request.requestId,
      modelId: request.modelId,
      providerId: response?.providerId ?? request.providerId,
      promptVersionId: request.prompt.id,
      promptVersion: request.prompt.version,
      status,
      cost,
      usedFallback:
        status === "offline" ||
        status === "fallback" ||
        status === "timeout" ||
        status === "cancelled",
      errorCode: providerErrorCode ?? failure?.code,
      ...(failureDetail !== undefined ? { failureDetail } : {}),
    },
  };
}

export function deterministicOfflineFallback(request: AIRequest): AIResponse {
  return fallbackResponse(request);
}

export type { TokenUsage };
