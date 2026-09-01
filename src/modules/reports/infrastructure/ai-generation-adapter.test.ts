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
import type { ReportContext, ReportStats } from "../contracts.ts";

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

function weeklyDefinition() {
  const found = BUILTIN_REPORT_DEFINITIONS.find(
    (item) => item.definitionId === "reports.weekly",
  );
  if (!found) throw new Error("test setup: weekly definition missing");
  return found;
}

function context(): ReportContext {
  return { evidence: [], summary: "Fixed offline summary text." };
}

function response(text: string, providerId = "offline"): AIResponse {
  return {
    providerId,
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
      response: response("The daily brief content.", "profile"),
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
  assert.match(result.body ?? "", /## 今日总结/);
});

test("daily reports ignore model Markdown and use the fixed document renderer", async () => {
  let called = false;
  const generation = createReportGenerationPort({
    ai: {
      async execute() {
        called = true;
        throw new Error("daily report must not call the model");
      },
    },
  });
  const result = await generation.generate({
    definition: definition(),
    context: {
      evidence: [],
      summary: "model must not control the document",
      stats: {
        periodLabel: "今日 2026-08-31",
        sessions: 1,
        turns: 1,
        tokens: 100,
        costUsd: 1,
        bySource: [
          {
            source: "Codex",
            sessions: 1,
            tokens: 100,
            costUsd: 1,
            edits: 0,
            durationMin: 1,
          },
        ],
        projects: [],
        edits: 0,
        durationMin: 1,
      },
    },
  });
  assert.equal(called, false);
  assert.equal(result.status, "succeeded");
  assert.match(result.body ?? "", /^# AITracker 日报/);
});

test("a configured model adds a bounded AI analysis without changing the fixed report", async () => {
  const captured: { request?: AIRequest } = {};
  const generation = createReportGenerationPort({
    ai: fake(
      {
        summary: summary("completed"),
        response: response(
          "Codex 与主要项目承载了本周期的大部分使用，模型与成本分布显示使用结构较为集中。缓存数据表明已有较高比例的上下文被复用，但这本身不代表效率高低。\n\n建议：\n1. 优先回看报告中 Token 与轮次同时集中的会话，确认是否存在可复用流程。\n2. 结合模型成本差异检查后续任务的模型选择。",
          "profile",
        ),
      },
      captured,
    ),
  });
  const result = await generation.generate({
    definition: definition(),
    modelId: "profile-1",
    context: {
      evidence: [],
      summary: "model receives the fixed report only",
      stats: {
        periodLabel: "今日 2026-08-31",
        sessions: 1,
        turns: 3,
        tokens: 100,
        costUsd: 1,
        bySource: [
          {
            source: "Codex",
            sessions: 1,
            tokens: 100,
            costUsd: 1,
            edits: 0,
            durationMin: 2,
          },
        ],
        projects: ["aitracker"],
        edits: 0,
        durationMin: 2,
      },
    },
  });

  assert.equal(result.status, "succeeded");
  assert.match(result.body ?? "", /## AI 总结/);
  assert.match(result.body ?? "", /建议：\n1\./);
  assert.match(result.body ?? "", /## 今日概览/);
  assert.ok(
    (result.body ?? "").indexOf("## AI 总结") <
      (result.body ?? "").indexOf("## 今日概览"),
  );
  assert.equal(captured.request?.providerId, "profile");
  assert.match(captured.request?.prompt.id ?? "", /daily\.zh-CN\.ai-summary/);
  assert.match(captured.request?.input.text ?? "", /^# AITracker 日报/);
  assert.doesNotMatch(captured.request?.input.text ?? "", /## AI 总结/);
});

test("AI summary failure keeps the fixed report usable", async () => {
  const generation = createReportGenerationPort({
    ai: {
      async execute() {
        throw new Error("provider unavailable");
      },
    },
  });
  const result = await generation.generate({
    definition: definition(),
    modelId: "profile-1",
    context: {
      evidence: [],
      summary: "fixed context",
      stats: {
        periodLabel: "今日 2026-08-31",
        sessions: 1,
        turns: 1,
        tokens: 100,
        costUsd: 1,
        bySource: [],
        projects: [],
        edits: 0,
        durationMin: 1,
      },
    },
  });
  assert.equal(result.status, "succeeded");
  assert.match(result.body ?? "", /^# AITracker 日报/);
  assert.doesNotMatch(result.body ?? "", /## AI 总结/);
});

test("weekly reports use the fixed localized document renderer", async () => {
  let called = false;
  const generation = createReportGenerationPort({
    ai: {
      async execute() {
        called = true;
        throw new Error("weekly report must not call the model");
      },
    },
  });
  const result = await generation.generate({
    definition: weeklyDefinition(),
    locale: "en-US",
    context: {
      evidence: [],
      summary: "model must not control the document",
      stats: {
        periodLabel: "2026/08/24 - 2026/08/30",
        sessions: 1,
        turns: 2,
        tokens: 100,
        costUsd: 1,
        bySource: [
          {
            source: "Codex",
            sessions: 1,
            tokens: 100,
            costUsd: 1,
            edits: 0,
            durationMin: 1,
          },
        ],
        projects: [],
        edits: 0,
        durationMin: 1,
      },
    },
  });
  assert.equal(result.status, "succeeded");
  assert.equal(called, false);
  assert.match(result.body ?? "", /^# AITracker Weekly Report/);
  assert.match(result.body ?? "", /This week's summary/);
  assert.doesNotMatch(result.body ?? "", /本周|蒸馏|记忆|工作流/);
});

test("monthly reports use the fixed monthly localized document renderer", async () => {
  let called = false;
  const generation = createReportGenerationPort({
    ai: {
      async execute() {
        called = true;
        throw new Error("monthly report must not call the model");
      },
    },
  });
  const result = await generation.generate({
    definition: weeklyDefinition(),
    templateKind: "monthly",
    locale: "en-US",
    context: {
      evidence: [],
      summary: "model must not control the document",
      stats: {
        periodLabel: "2026/08/01 - 2026/08/31",
        sessions: 1,
        turns: 2,
        tokens: 100,
        costUsd: 1,
        bySource: [
          {
            source: "Codex",
            sessions: 1,
            tokens: 100,
            costUsd: 1,
            edits: 0,
            durationMin: 1,
          },
        ],
        projects: [],
        edits: 0,
        durationMin: 1,
      },
    },
  });
  assert.equal(result.status, "succeeded");
  assert.equal(called, false);
  assert.match(result.body ?? "", /^# AITracker Monthly Report/);
  assert.match(result.body ?? "", /This month's summary/);
  assert.doesNotMatch(result.body ?? "", /本月|蒸馏|记忆|工作流/);
});

test("monthly renderer tolerates missing optional breakdown arrays", async () => {
  const generation = createReportGenerationPort({
    ai: {
      async execute() {
        throw new Error("incomplete statistics must not call the model");
      },
    },
  });
  const result = await generation.generate({
    definition: weeklyDefinition(),
    templateKind: "monthly",
    locale: "en-US",
    context: {
      evidence: [],
      summary: "incomplete monthly statistics",
      stats: {
        periodLabel: "2026/08/01 - 2026/08/31",
        sessions: 1,
        turns: 2,
        tokens: 100,
        costUsd: 1,
        edits: 0,
        durationMin: 1,
        projects: [],
      } as unknown as ReportStats,
    },
  });
  assert.equal(result.status, "succeeded");
  assert.match(result.body ?? "", /^# AITracker Monthly Report/);
});

test("weekly and monthly generation fail instead of saving an offline placeholder", async () => {
  for (const templateKind of ["weekly", "monthly"] as const) {
    const generation = createReportGenerationPort({
      ai: fake({
        summary: summary("completed"),
        response: response("Offline deterministic fallback text."),
      }),
    });
    const result = await generation.generate({
      definition: weeklyDefinition(),
      templateKind,
      context: context(),
      locale: "en-US",
    });
    assert.equal(result.status, "failed");
    assert.equal(result.errorCode, "errors.reports.generationFailed");
    assert.equal(result.retryable, true);
    assert.equal(result.body, undefined);
  }
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
      { summary: summary("completed"), response: response("ok", "profile") },
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
  assert.equal(captured.request?.prompt.version, definition().template.version);
  assert.ok(
    captured.request?.prompt.template.startsWith(
      `${definition().template.template}\n\n`,
    ),
  );
  assert.match(captured.request?.prompt.template ?? "", /全文必须使用简体中文/);
  assert.equal(captured.request?.input.text, "Fixed offline summary text.");
  assert.equal(captured.request?.budgetUsd, 0.5);
  assert.equal(captured.request?.timeoutMs, 300_000);
  assert.ok(captured.request?.requestId, "requestId must be populated");
});

test("the AI request selects the prompt for the requested locale", async () => {
  const locales = ["en-US", "ja-JP", "ko-KR"] as const;
  for (const locale of locales) {
    const captured: { request?: AIRequest } = {};
    const generation = createReportGenerationPort({
      ai: fake(
        { summary: summary("completed"), response: response("ok", "profile") },
        captured,
      ),
    });
    await generation.generate({
      definition: definition(),
      context: context(),
      locale,
    });
    assert.equal(
      captured.request?.prompt.id,
      `reports.daily.${locale}.default`,
    );
    assert.match(
      captured.request?.prompt.template ?? "",
      locale === "en-US"
        ? /You are AITracker/
        : locale === "ja-JP"
          ? /あなたは/
          : /당신은/,
    );
    assert.match(
      captured.request?.prompt.template ?? "",
      locale === "en-US"
        ? /write the entire report in English/i
        : locale === "ja-JP"
          ? /レポート全文を日本語/
          : /보고서 전체를 한국어/,
    );
  }
});

test("resolveModelId routes generation to the profile-backed provider", async () => {
  const captured: { request?: AIRequest } = {};
  const generation = createReportGenerationPort({
    ai: fake(
      { summary: summary("completed"), response: response("ok") },
      captured,
    ),
    resolveModelId: async () => "m-profile-1",
  });
  await generation.generate({
    definition: definition(),
    context: context(),
  });
  assert.ok(captured.request);
  assert.equal(captured.request?.modelId, "m-profile-1");
  // The registry routes by providerId; a non-default model id is a saved
  // profile id, so the request must target the `profile` provider.
  assert.equal(captured.request?.providerId, "profile");
});

test("resolveModelId returning null keeps the default offline model id", async () => {
  const captured: { request?: AIRequest } = {};
  const generation = createReportGenerationPort({
    ai: fake(
      { summary: summary("completed"), response: response("ok") },
      captured,
    ),
    resolveModelId: async () => null,
  });
  await generation.generate({
    definition: definition(),
    context: context(),
  });
  assert.ok(captured.request);
  assert.equal(captured.request?.modelId, "report-generator");
  assert.equal(captured.request?.providerId, undefined);
});

test("an explicit input modelId wins over resolveModelId", async () => {
  const captured: { request?: AIRequest } = {};
  const generation = createReportGenerationPort({
    ai: fake(
      { summary: summary("completed"), response: response("ok") },
      captured,
    ),
    resolveModelId: async () => "m-resolved",
  });
  await generation.generate({
    definition: definition(),
    context: context(),
    modelId: "m-explicit",
  });
  assert.ok(captured.request);
  assert.equal(captured.request?.modelId, "m-explicit");
  assert.equal(captured.request?.providerId, "profile");
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
