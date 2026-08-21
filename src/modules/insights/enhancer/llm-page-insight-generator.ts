/**
 * Provider-boundary generator for the Insight Enhancer. It builds the single
 * `AIRequest` handed to the composition-root executor (`providerId: "profile"`,
 * `modelId: <active profile id>`), keeping the payload to the redacted
 * candidate facts only. `assertPayloadSafe` is the final outbound audit point:
 * a secret, path, command, injection, or entity name never reaches the model.
 */
import type { AIExecutorPort } from "../../ai-orchestration/ai-executor.ts";
import type {
  AIExecutionStatus,
  AIExecutionSummary,
  TokenUsage,
} from "../../ai-orchestration/contracts.ts";
import type {
  InsightEnhancementInput,
  InsightSurfaceId,
} from "../page/contracts.ts";
import { MAX_PAYLOAD_BYTES, assertPayloadSafe } from "./validation.ts";

/**
 * Rules render first and never wait for the model. This background window
 * accommodates reasoning models that may count internal reasoning against the
 * total token budget. Visible output remains bounded by the strict response
 * schema, 160 characters per analysis and at most 7 lines.
 */
export const INSIGHT_MODEL_TIMEOUT_MS = 30_000;
export const INSIGHT_MAX_OUTPUT_TOKENS = 8192;

export interface InsightGeneratePrompt {
  readonly id: string;
  readonly version: number;
  readonly template: string;
}

export interface InsightGenerateRequest {
  readonly surface: InsightSurfaceId;
  readonly locale: string;
  readonly candidates: InsightEnhancementInput["candidates"];
  readonly prompt: InsightGeneratePrompt;
  readonly profileId: string;
  readonly modelLabel: string;
  readonly forbiddenEntities?: readonly string[];
  readonly signal?: AbortSignal;
}

export type InsightGenerateStatus =
  "completed" | "timeout" | "failed" | "budget-exceeded";

export interface InsightGenerateResult {
  readonly status: InsightGenerateStatus;
  readonly requestId: string;
  readonly text?: string;
  readonly usage?: TokenUsage;
  /** Present only when the executor was actually invoked. */
  readonly summary?: AIExecutionSummary;
}

export interface LLMInsightGenerator {
  generate(request: InsightGenerateRequest): Promise<InsightGenerateResult>;
}

function mapStatus(status: AIExecutionStatus): InsightGenerateStatus {
  switch (status) {
    case "completed":
      return "completed";
    case "timeout":
      return "timeout";
    case "budget-exceeded":
      return "budget-exceeded";
    default:
      // offline / fallback / cancelled / failed all surface as a local failure
      // to the enhancer; the deterministic fallback text is never enhanced.
      return "failed";
  }
}

export function createLLMInsightGenerator(options: {
  readonly ai: AIExecutorPort;
}): LLMInsightGenerator {
  const ai = options.ai;

  return {
    async generate(request) {
      const requestId = crypto.randomUUID();
      // Adapter version is a local cache concern and preferences/profile data
      // are server-side controls. Neither belongs in the provider payload.
      const payload = {
        surface: request.surface,
        locale: request.locale,
        candidates: request.candidates,
      };
      try {
        assertPayloadSafe(payload, {
          forbiddenEntities: request.forbiddenEntities,
        });
      } catch {
        return { status: "failed", requestId };
      }
      const inputText = JSON.stringify(payload);
      if (inputText.length > MAX_PAYLOAD_BYTES) {
        return { status: "failed", requestId };
      }
      const result = await ai.execute({
        requestId,
        providerId: "profile",
        modelId: request.profileId,
        prompt: request.prompt,
        input: { text: inputText },
        maxOutputTokens: INSIGHT_MAX_OUTPUT_TOKENS,
        timeoutMs: INSIGHT_MODEL_TIMEOUT_MS,
        signal: request.signal,
      });
      const summary = result.summary;
      return {
        status: mapStatus(summary.status),
        requestId,
        text: result.response?.text,
        usage: result.response?.usage,
        summary,
      };
    },
  };
}
