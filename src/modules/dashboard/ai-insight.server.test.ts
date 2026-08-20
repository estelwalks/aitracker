import assert from "node:assert/strict";
import test from "node:test";

import {
  createDashboardAIInsightService,
  toDashboardAIInsightInput,
  type DashboardAIInsightInput,
  type DashboardAIInsightRuntimeConfig,
} from "./ai-insight.server.ts";
import type { DashboardV2Snapshot } from "./contracts.ts";

const openaiConfig: DashboardAIInsightRuntimeConfig = {
  protocol: "openai",
  auth: "bearer",
  endpoint: "https://llm.example.test/v1",
  apiKey: "test-key-123456",
  model: "trusted-model",
};

const anthropicConfig: DashboardAIInsightRuntimeConfig = {
  protocol: "anthropic",
  auth: "x-api-key",
  endpoint: "https://llm.example.test/v1",
  apiKey: "test-key-123456",
  model: "claude-model",
};

function input(): DashboardAIInsightInput {
  return {
    range: { preset: "30d" },
    totals: {
      events: 12,
      totalTokens: 8100,
      inputTokens: 5000,
      cachedInputTokens: 2000,
      outputTokens: 1100,
      cacheRatePercent: 28.5,
      estimatedCostUsd: 0.24,
      costQuality: "available",
    },
    topModels: [{ label: "gpt-5", tokens: 8100, events: 12 }],
    topProjects: [{ label: "trusttools_webapp", tokens: 8100, events: 12 }],
    topTools: [{ label: "Codex", tokens: 8100, events: 12 }],
    monitoring: {
      running: true,
      pendingCount: 0,
      collectorHealth: [{ id: "usage", state: "healthy" }],
    },
    security: {
      available: true,
      assessedAssets: 6,
      failedAssets: 0,
      suspicious: 0,
      dangerous: 0,
    },
    outputs: {
      securityRuns: { available: false, count: null },
      distillationOutputs: { available: true, count: 2 },
      dailyReports: { available: true, count: 1 },
    },
  };
}

function completion(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function anthropicCompletion(content: string): Response {
  return new Response(
    JSON.stringify({ content: [{ type: "text", text: content }] }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
}

function validOutput(): string {
  return JSON.stringify({
    headline: "Usage is steady and cache coverage is improving.",
    insights: [
      {
        title: "Cache coverage",
        detail: "Cached input represents 28.5% of observed input volume.",
        severity: "info",
      },
    ],
  });
}

test("unconfigured service never invokes fetch and returns explicit state", async () => {
  let calls = 0;
  const service = createDashboardAIInsightService({
    resolveConfig: async () => null,
    fetch: (async () => {
      calls += 1;
      return completion(validOutput());
    }) as typeof fetch,
  });
  assert.deepEqual(service.read(), {
    status: "not-configured",
    configured: false,
    generatedAt: null,
    model: null,
    insight: null,
  });
  assert.equal((await service.refresh(input())).status, "not-configured");
  assert.equal(calls, 0);
});

test("a failing profile resolution reports not-configured", async () => {
  let calls = 0;
  const service = createDashboardAIInsightService({
    resolveConfig: async () => {
      throw new Error("repository unavailable");
    },
    fetch: (async () => {
      calls += 1;
      return completion(validOutput());
    }) as typeof fetch,
  });
  const result = await service.refresh(input());
  assert.deepEqual(result, {
    status: "not-configured",
    configured: false,
    generatedAt: null,
    model: null,
    insight: null,
  });
  assert.deepEqual(service.read(), result);
  assert.equal(calls, 0);
});

test("OpenAI-compatible request sends only allowlisted aggregate input", async () => {
  let sentUrl: string | undefined;
  let sentHeaders: Record<string, string> | undefined;
  let sentBody: unknown;
  const service = createDashboardAIInsightService({
    resolveConfig: async () => openaiConfig,
    fetch: (async (url, init) => {
      sentUrl = String(url);
      sentHeaders = init?.headers as Record<string, string>;
      sentBody = JSON.parse(String(init?.body));
      return completion(validOutput());
    }) as typeof fetch,
  });
  const result = await service.refresh(input());
  assert.equal(result.status, "ready");
  assert.equal(result.model, "trusted-model");
  assert.equal(result.insight?.insights.length, 1);
  assert.equal(sentUrl, "https://llm.example.test/v1/chat/completions");
  assert.equal(sentHeaders?.authorization, "Bearer test-key-123456");
  assert.equal(sentHeaders?.["content-type"], "application/json");
  const request = sentBody as {
    model: string;
    messages: Array<{ role: string; content: string }>;
  };
  assert.equal(request.model, "trusted-model");
  assert.equal(request.messages.length, 2);
  const outbound = request.messages[1]?.content ?? "";
  assert.deepEqual(JSON.parse(outbound), input());
  assert.doesNotMatch(
    outbound,
    /\/Users\/|\/home\/|sessionId|command|prompt|sk-/i,
  );
  assert.equal(JSON.stringify(result).includes("test-key-123456"), false);
  assert.equal(JSON.stringify(result).includes("llm.example.test"), false);
});

test("Anthropic request uses the messages endpoint, x-api-key auth and system template", async () => {
  let sentUrl: string | undefined;
  let sentHeaders: Record<string, string> | undefined;
  let sentBody: unknown;
  const service = createDashboardAIInsightService({
    resolveConfig: async () => anthropicConfig,
    fetch: (async (url, init) => {
      sentUrl = String(url);
      sentHeaders = init?.headers as Record<string, string>;
      sentBody = JSON.parse(String(init?.body));
      return anthropicCompletion(validOutput());
    }) as typeof fetch,
  });
  const result = await service.refresh(input());
  assert.equal(result.status, "ready");
  assert.equal(result.model, "claude-model");
  assert.equal(
    result.insight?.headline,
    "Usage is steady and cache coverage is improving.",
  );
  assert.equal(sentUrl, "https://llm.example.test/v1/messages");
  assert.equal(sentHeaders?.["x-api-key"], "test-key-123456");
  assert.equal(sentHeaders?.["anthropic-version"], "2023-06-01");
  assert.equal(sentHeaders?.["content-type"], "application/json");
  const request = sentBody as {
    model: string;
    max_tokens: number;
    system: string;
    messages: Array<{ role: string; content: string }>;
  };
  assert.equal(request.model, "claude-model");
  assert.equal(request.max_tokens, 600);
  assert.match(request.system, /aggregate JSON/);
  assert.equal(request.messages.length, 1);
  assert.equal(request.messages[0]?.role, "user");
  const outbound = request.messages[0]?.content ?? "";
  assert.deepEqual(JSON.parse(outbound), input());
  assert.doesNotMatch(
    outbound,
    /\/Users\/|\/home\/|sessionId|command|prompt|sk-/i,
  );
  assert.equal(JSON.stringify(result).includes("test-key-123456"), false);
  assert.equal(JSON.stringify(result).includes("llm.example.test"), false);
});

test("each refresh re-resolves the profile and rebuilds the provider", async () => {
  const configs = [openaiConfig, anthropicConfig];
  let index = 0;
  const seenUrls: string[] = [];
  const service = createDashboardAIInsightService({
    resolveConfig: async () => configs[index] ?? null,
    fetch: (async (url) => {
      seenUrls.push(String(url));
      return index === 1
        ? anthropicCompletion(validOutput())
        : completion(validOutput());
    }) as typeof fetch,
  });
  const first = await service.refresh(input());
  assert.equal(first.status, "ready");
  assert.equal(first.model, "trusted-model");
  index = 1;
  const second = await service.refresh(input());
  assert.equal(second.status, "ready");
  assert.equal(second.model, "claude-model");
  assert.deepEqual(seenUrls, [
    "https://llm.example.test/v1/chat/completions",
    "https://llm.example.test/v1/messages",
  ]);
});

test("timeout returns a failed safe DTO without forwarding fallback text", async () => {
  const service = createDashboardAIInsightService({
    resolveConfig: async () => openaiConfig,
    timeoutMs: 5,
    fetch: (() => new Promise<Response>(() => undefined)) as typeof fetch,
  });
  const result = await service.refresh(input());
  assert.deepEqual(result, {
    status: "failed",
    configured: true,
    generatedAt: null,
    model: "trusted-model",
    insight: null,
  });
});

test("invalid or sensitive provider output is rejected", async () => {
  const service = createDashboardAIInsightService({
    resolveConfig: async () => openaiConfig,
    fetch: (async () =>
      completion(
        JSON.stringify({
          headline: "Read /Users/alice/private.txt",
          insights: [{ title: "Unsafe", detail: "secret", severity: "risk" }],
        }),
      )) as typeof fetch,
  });
  const result = await service.refresh(input());
  assert.equal(result.status, "invalid-output");
  assert.equal(result.insight, null);
});

test("TTL cache is read-only and concurrent refreshes are deduplicated", async () => {
  let now = 1_000;
  let calls = 0;
  let resolveResponse: ((value: Response) => void) | undefined;
  const response = new Promise<Response>((resolve) => {
    resolveResponse = resolve;
  });
  const service = createDashboardAIInsightService({
    resolveConfig: async () => openaiConfig,
    ttlMs: 100,
    now: () => now,
    fetch: (() => {
      calls += 1;
      return response;
    }) as typeof fetch,
  });
  const first = service.refresh(input());
  const second = service.refresh(input());
  assert.equal(first, second);
  resolveResponse?.(completion(validOutput()));
  assert.equal((await first).status, "ready");
  assert.equal(calls, 1);
  assert.equal(service.read().status, "ready");
  now += 101;
  assert.equal(service.read().status, "idle");
});

test("allowlist projection strips an unexpected path-like project label", () => {
  const snapshot = {
    generatedAt: "2026-08-10T00:00:00.000Z",
    mode: "real",
    events: [
      {
        source: "codex",
        timestamp: "2026-08-10T00:00:00.000Z",
        model: "gpt-5",
        project: "/Users/alice/private-project",
        inputTokens: 50,
        cachedInputTokens: 10,
        cacheCreationInputTokens: 0,
        outputTokens: 10,
        reasoningOutputTokens: 0,
        totalTokens: 70,
        context: {
          textResponses: 0,
          toolCalls: 0,
          skillCalls: 0,
          toolOutputCalls: 0,
        },
        evidence: {
          textResponses: false,
          toolCalls: false,
          skillCalls: false,
          toolOutputCalls: false,
          reasoningTokens: false,
          systemPromptTokens: false,
        },
      },
    ],
    tools: [
      {
        id: "codex",
        name: "Codex",
        available: true,
        detected: true,
        usageSupport: "native",
      },
    ],
    skills: { available: false, count: 0, generatedAt: null },
    sessions: {
      available: false,
      generatedAt: null,
      byProjectDay: [],
      bySourceDay: [],
    },
    pricingAvailable: false,
    outputAvailability: {
      securityRuns: { available: false, count: null },
      distillationOutputs: { available: false, count: null },
      distillationBreakdown: { capability: null, memory: null },
      dailyReports: { available: false, count: null },
      weeklyReports: { available: false, count: null },
      monthlyReports: { available: false, count: null },
    },
  } as DashboardV2Snapshot;
  const aggregate = toDashboardAIInsightInput({ snapshot, monitoring: null });
  assert.deepEqual(aggregate.topProjects, [
    { label: "project", tokens: 70, events: 1 },
  ]);
  assert.doesNotMatch(JSON.stringify(aggregate), /\/Users\/|private-project/i);
});
