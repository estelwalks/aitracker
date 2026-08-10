import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import type {
  AIErrorCode,
  AIExecutionResult,
  AIExecutionStatus,
  AIRequest,
  AIResponse,
  CostState,
} from "../../../modules/ai-orchestration/contracts.ts";
import { BUILTIN_REPORT_DEFINITIONS } from "../domain.ts";
import { createReportGenerationPort } from "./ai-generation-adapter.ts";
import type { ReportContext } from "../contracts.ts";

const UNKNOWN_COST: CostState = {
  confidence: "unknown",
  currency: "USD",
  reason: "no-pricing",
};

function definition() {
  const found = BUILTIN_REPORT_DEFINITIONS.find(
    (item) => item.definitionId === "reports.daily",
  );
  if (!found) throw new Error("test setup: daily definition missing");
  return found;
}

function context(): ReportContext {
  return { evidence: [], summary: "Fixed offline summary text." };
}

function response(text: string): AIResponse {
  return {
    providerId: "offline",
    modelId: "report-generator",
    text,
    finishReason: "stop",
  };
}

function summary(
  status: AIExecutionStatus,
  errorCode?: AIErrorCode,
): AIExecutionResult["summary"] {
  return {
    requestId: randomUUID(),
    modelId: "report-generator",
    providerId: "offline",
    promptVersionId: definition().template.templateId,
    promptVersion: 1,
    status,
    cost: UNKNOWN_COST,
    usedFallback:
      status === "offline" ||
      status === "fallback" ||
      status === "timeout" ||
      status === "cancelled",
    errorCode,
  };
}

function fake(
  result: AIExecutionResult,
  capture?: {
    request?: AIRequest;
  },
) {
  return {
    async execute(request: AIRequest): Promise<AIExecutionResult> {
      if (capture) capture.request = request;
      return result;
    },
  };
}

test("completed with response text maps to succeeded and passes body through", async () => {
  const generation = createReportGenerationPort({
    ai: fake({
      summary: summary("completed"),
      response: response("The daily brief content."),
    }),
  });
  const result = await generation.generate({
    definition: definition(),
    context: context(),
  });
  assert.equal(result.status, "succeeded");
  assert.equal(result.body, "The daily brief content.");
});

test("offline preserves the fallback draft body", async () => {
  const generation = createReportGenerationPort({
    ai: fake({
      summary: summary("offline"),
      response: response("Offline deterministic fallback text."),
    }),
  });
  const result = await generation.generate({
    definition: definition(),
    context: context(),
  });
  assert.equal(result.status, "offline");
  assert.equal(result.body, "Offline deterministic fallback text.");
});

test("fallback (provider error path) also maps to offline", async () => {
  const generation = createReportGenerationPort({
    ai: fake({
      summary: summary("fallback"),
      response: response("Offline deterministic fallback text."),
    }),
  });
  const result = await generation.generate({
    definition: definition(),
    context: context(),
  });
  assert.equal(result.status, "offline");
  assert.ok(result.body);
});

test("budget-exceeded maps to budget-exceeded with a stable error code", async () => {
  const generation = createReportGenerationPort({
    ai: fake({ summary: summary("budget-exceeded", "ai.budget-exceeded") }),
  });
  const result = await generation.generate({
    definition: definition(),
    context: context(),
  });
  assert.equal(result.status, "budget-exceeded");
  assert.equal(result.errorCode, "errors.reports.budgetExceeded");
  assert.equal(result.body, undefined);
});

test("timeout maps to failed with retryable=true", async () => {
  const generation = createReportGenerationPort({
    ai: fake({ summary: summary("timeout", "ai.timeout") }),
  });
  const result = await generation.generate({
    definition: definition(),
    context: context(),
  });
  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "errors.reports.timeout");
  assert.equal(result.retryable, true);
});

test("cancelled maps to failed with retryable=false", async () => {
  const generation = createReportGenerationPort({
    ai: fake({ summary: summary("cancelled", "ai.cancelled") }),
  });
  const result = await generation.generate({
    definition: definition(),
    context: context(),
  });
  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "errors.reports.cancelled");
  assert.equal(result.retryable, false);
});

test("failed maps to failed with retryable=false", async () => {
  const generation = createReportGenerationPort({
    ai: fake({ summary: summary("failed", "ai.provider-failed") }),
  });
  const result = await generation.generate({
    definition: definition(),
    context: context(),
  });
  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "errors.reports.generationFailed");
  assert.equal(result.retryable, false);
});

test("the AI request carries the definition template and context summary", async () => {
  const captured: { request?: AIRequest } = {};
  const generation = createReportGenerationPort({
    ai: fake(
      { summary: summary("completed"), response: response("ok") },
      captured,
    ),
  });
  await generation.generate({
    definition: definition(),
    context: context(),
    budgetUsd: 0.5,
  });
  assert.ok(captured.request);
  assert.equal(captured.request?.modelId, "report-generator");
  assert.equal(captured.request?.prompt.id, "reports.daily.default");
  assert.equal(captured.request?.prompt.version, 1);
  assert.equal(
    captured.request?.prompt.template,
    definition().template.template,
  );
  assert.equal(captured.request?.input.text, "Fixed offline summary text.");
  assert.equal(captured.request?.budgetUsd, 0.5);
  assert.equal(captured.request?.timeoutMs, 300_000);
  assert.ok(captured.request?.requestId, "requestId must be populated");
});

test("privacy: context is a fixed summary with no session/path/token data", async () => {
  const captured: { request?: AIRequest } = {};
  const generation = createReportGenerationPort({
    ai: fake(
      { summary: summary("completed"), response: response("ok") },
      captured,
    ),
  });
  const ctx = context();
  await generation.generate({ definition: definition(), context: ctx });
  // The adapter must not mutate or expand the context; it forwards summary
  // verbatim. With the offline context port the summary is a fixed string.
  assert.equal(captured.request?.input.text, ctx.summary);
  assert.doesNotMatch(ctx.summary, /\/Users\/|\/home\/|bearer|sk-|password/i);
});

test("completed without response text maps to failed (no body to emit)", async () => {
  const generation = createReportGenerationPort({
    ai: fake({ summary: summary("completed") }),
  });
  const result = await generation.generate({
    definition: definition(),
    context: context(),
  });
  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "errors.reports.generationFailed");
  assert.equal(result.retryable, false);
});
