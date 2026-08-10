import assert from "node:assert/strict";
import test from "node:test";
import { deterministicOfflineFallback, executeAIRequest } from "./index.ts";
import {
  redactInput,
  redactResponse,
  toPublicExecutionResult,
} from "./redaction.ts";
import type { AIRequest, AIResponse, PricingPort } from "./contracts.ts";

const prompt = {
  id: "summary",
  version: 2,
  template: "Summarize {{text}}",
} as const;
function request(overrides: Partial<AIRequest> = {}): AIRequest {
  return {
    requestId: "req-1",
    modelId: "model-a",
    prompt,
    input: { text: "private prompt", variables: { apiKey: "sk-secret-value" } },
    ...overrides,
  };
}

const priced: PricingPort = {
  estimate: ({ usage }) => ({
    confidence: usage ? "exact" : "estimated",
    amountUsd: usage ? 0.01 : 0.8,
    currency: "USD",
    reason: usage ? "priced" : "estimated",
  }),
};

test("offline/no provider uses deterministic fallback with unknown offline cost", async () => {
  const result = await executeAIRequest(request());
  assert.equal(result.summary.status, "offline");
  assert.equal(result.summary.cost.reason, "offline");
  assert.equal(
    result.response?.text,
    deterministicOfflineFallback(request()).text,
  );
});

test("provider failure falls back and exposes only stable error metadata", async () => {
  const result = await executeAIRequest(request(), {
    router: {
      route: () => ({
        providerId: "p",
        invoke: async () => {
          throw new Error("network secret");
        },
      }),
    },
  });
  assert.equal(result.summary.status, "fallback");
  assert.equal(result.summary.errorCode, "ai.provider-failed");
  assert.equal(result.summary.usedFallback, true);
});

test("budget exceeded prevents provider invocation", async () => {
  let called = false;
  const result = await executeAIRequest(request({ budgetUsd: 0.1 }), {
    router: {
      route: () => ({
        providerId: "p",
        invoke: async () => {
          called = true;
          return { providerId: "p", modelId: "model-a", text: "x" };
        },
      }),
    },
    pricing: priced,
  });
  assert.equal(called, false);
  assert.equal(result.summary.status, "budget-exceeded");
  assert.equal(result.summary.errorCode, "ai.budget-exceeded");
});

test("timeout and cancellation are bounded and fallback locally", async () => {
  const slow = {
    providerId: "p",
    invoke: () => new Promise<AIResponse>(() => undefined),
  };
  const timed = await executeAIRequest(request({ timeoutMs: 5 }), {
    router: { route: () => slow },
  });
  assert.equal(timed.summary.status, "timeout");
  const controller = new AbortController();
  controller.abort();
  const cancelled = await executeAIRequest(
    request({ signal: controller.signal }),
    { router: { route: () => slow } },
  );
  assert.equal(cancelled.summary.status, "cancelled");
});

test("redaction removes input/output and sensitive fields", () => {
  const input = redactInput(request().input);
  assert.equal(input.text, "private prompt");
  assert.equal(input.variables?.apiKey, "[REDACTED]");
  const output = redactResponse({
    providerId: "p",
    modelId: "m",
    text: "secret response",
    usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
  });
  assert.equal(output.text, "[REDACTED_OUTPUT]");
  assert.equal(output.usage, undefined);
});

test("public execution projection contains summary only", async () => {
  const result = await executeAIRequest(request());
  const publicResult = toPublicExecutionResult(result);
  assert.equal("response" in publicResult, false);
  assert.equal(publicResult.promptVersionId, "summary");
});

test("pricing remains provider/model injected and can be exact or estimated", async () => {
  const result = await executeAIRequest(request(), {
    router: {
      route: () => ({
        providerId: "p",
        invoke: async () => ({
          providerId: "p",
          modelId: "model-a",
          text: "ok",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        }),
      }),
    },
    pricing: priced,
  });
  assert.equal(result.summary.status, "completed");
  assert.equal(result.summary.cost.confidence, "exact");
  assert.equal(result.summary.promptVersion, 2);
});
