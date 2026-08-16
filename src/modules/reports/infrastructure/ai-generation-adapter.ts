/**
 * Adapts `AIExecutorPort` (from ai-orchestration) to the reports module's
 * `ReportGenerationPort`. Mirrors the distillation adapter's structural-typing
 * approach: we declare a local interface compatible with `AIExecutorPort` so
 * reports does not need to import ai-orchestration's concrete contract (which
 * would tighten a module boundary that the verifier keeps intentionally loose).
 *
 * Status mapping is exhaustive over `AIExecutionStatus`:
 *   completed          → succeeded (body = response.text)
 *   offline/fallback   → offline   (keep deterministic fallback text as a draft)
 *   budget-exceeded    → budget-exceeded (no body)
 *   timeout/cancelled  → failed, retryable when AI declares it retryable
 *   failed             → failed, not retryable
 *
 * Privacy: `response.text` is the model's generated content. With the offline
 * provider it is a fixed deterministic string with no user/session/path data,
 * so passing it through is safe. The application layer still runs it through
 * `safeReportText` before persistence as defence-in-depth.
 */
import { randomUUID } from "node:crypto";

import type {
  AIExecutionResult,
  AIRequest,
} from "../../../modules/ai-orchestration/contracts.ts";
import { safeReportText } from "../domain.ts";
import type {
  ReportContext,
  ReportDefinition,
  ReportGenerationPort,
  ReportGenerationResult,
} from "../contracts.ts";

/** Structurally compatible with ai-orchestration's `AIExecutorPort`. */
export interface ReportAIExecutor {
  execute(request: AIRequest): Promise<AIExecutionResult>;
}

const REPORT_TIMEOUT_MS = 300_000;
const REPORT_MODEL_ID = "report-generator";

const FALLBACK_OFFLINE_TEXT =
  "Offline report fallback: no model response was available.";

export interface ReportGenerationAdapterOptions {
  readonly ai: ReportAIExecutor;
  /**
   * Resolves the model id for a generation (B-400). Injected by the
   * composition root to the active S-500 model profile id, so reports reuse
   * the profile-backed provider (a real model call) instead of the offline
   * fallback. `null`/undefined keeps the default `REPORT_MODEL_ID`.
   */
  readonly resolveModelId?: () => Promise<string | null>;
}

function offlineResult(text: string | undefined): ReportGenerationResult {
  // Preserve a usable draft body when the model was unavailable so the
  // dashboard can still show a (clearly offline) report. safeReportText may
  // throw on empty/sensitive input — guard so the adapter never fails closed
  // solely because the fallback text failed redaction.
  try {
    return {
      status: "offline",
      body: safeReportText(text ?? FALLBACK_OFFLINE_TEXT),
    };
  } catch {
    return {
      status: "offline",
      body: FALLBACK_OFFLINE_TEXT,
    };
  }
}

export function createReportGenerationPort(
  options: ReportGenerationAdapterOptions,
): ReportGenerationPort {
  return {
    async generate(input: {
      readonly definition: ReportDefinition;
      readonly context: ReportContext;
      readonly budgetUsd?: number;
      readonly modelId?: string;
    }): Promise<ReportGenerationResult> {
      const { definition, context, budgetUsd } = input;
      // Explicit input wins; otherwise the injected resolver (active profile
      // id) is awaited — the request must not be built until it settles.
      const modelId =
        input.modelId ?? (await options.resolveModelId?.()) ?? REPORT_MODEL_ID;
      // The composition registry only knows "offline" and "profile" (the
      // S-500 provider resolves a saved profile by request.modelId). Any model
      // id that is not the default therefore routes to the profile-backed
      // provider; the default keeps the previous offline routing.
      const providerId = modelId === REPORT_MODEL_ID ? undefined : "profile";
      const request: AIRequest = {
        requestId: randomUUID(),
        providerId,
        modelId,
        prompt: {
          id: definition.template.templateId,
          version: definition.template.version,
          template: definition.template.template,
        },
        input: { text: context.summary },
        budgetUsd,
        timeoutMs: REPORT_TIMEOUT_MS,
      };
      const result = await options.ai.execute(request);
      return mapResult(result);
    },
  };
}

function mapResult(result: AIExecutionResult): ReportGenerationResult {
  const { summary, response } = result;
  switch (summary.status) {
    case "completed":
      return response?.text
        ? { status: "succeeded", body: response.text }
        : {
            status: "failed",
            errorCode: "errors.reports.generationFailed",
            retryable: false,
          };
    case "offline":
    case "fallback":
      return offlineResult(response?.text);
    case "budget-exceeded":
      return {
        status: "budget-exceeded",
        errorCode: "errors.reports.budgetExceeded",
      };
    case "timeout":
      return {
        status: "failed",
        errorCode: "errors.reports.timeout",
        retryable: true,
      };
    case "cancelled":
      return {
        status: "failed",
        errorCode: "errors.reports.cancelled",
        retryable: false,
      };
    case "failed":
      return {
        status: "failed",
        errorCode: "errors.reports.generationFailed",
        retryable: false,
      };
    default: {
      // Exhaustiveness guard: a future AIExecutionStatus addition must not
      // silently succeed.
      const exhaustive: never = summary.status;
      void exhaustive;
      return {
        status: "failed",
        errorCode: summary.errorCode
          ? (`errors.${summary.errorCode}` as `errors.${string}`)
          : "errors.reports.generationFailed",
        retryable: false,
      };
    }
  }
}
