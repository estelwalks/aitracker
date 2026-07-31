import assert from "node:assert/strict";
import test from "node:test";

import type { LocalUsageEvent, LocalUsageSource } from "../lib/local-usage/types.ts";
import {
  buildProviderBudgetIndicators,
  readRemainingSecurityScans,
  resolveEventProvider,
} from "./index.tsx";

function event(
  model: string,
  source: LocalUsageSource = "codex",
  overrides: Partial<LocalUsageEvent> & { provider?: string } = {},
): LocalUsageEvent & { provider?: string } {
  return {
    source,
    timestamp: "2026-07-28T10:00:00+08:00",
    model,
    project: "test",
    inputTokens: 1_000_000,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 1_000_000,
    ...overrides,
  };
}

test("事件优先使用显式服务商，并按模型归属常见服务商", () => {
  assert.equal(
    resolveEventProvider(event("任意模型", "codex", { provider: "  自建服务  " })),
    "自建服务",
  );
  assert.equal(resolveEventProvider(event("claude-3-5-sonnet")), "Anthropic");
  assert.equal(resolveEventProvider(event("GPT-4o")), "OpenAI");
  assert.equal(resolveEventProvider(event("o3-mini")), "OpenAI");
  assert.equal(resolveEventProvider(event("Gemini-2.5-pro")), "Google");
  assert.equal(resolveEventProvider(event("deepseek-chat")), "DeepSeek");
  assert.equal(resolveEventProvider(event("Kimi-K2")), "Moonshot");
  assert.equal(resolveEventProvider(event("grok-4")), "xAI");
  assert.equal(resolveEventProvider(event("本地未知模型", "custom:原始来源")), "custom:原始来源");
});

test("服务商匹配忽略大小写并分别聚合日周月真实费用", () => {
  const now = new Date("2026-07-28T12:00:00+08:00");
  const indicators = buildProviderBudgetIndicators(
    [
      event("gpt-5.4", "codex", { timestamp: "2026-07-28T10:00:00+08:00" }),
      event("gpt-5.4", "codex", { timestamp: "2026-07-27T10:00:00+08:00" }),
      event("gpt-5.4", "codex", { timestamp: "2026-07-01T10:00:00+08:00" }),
      event("claude-3-5-sonnet", "claude-code"),
    ],
    [{ provider: "openAI", dailyBudget: 21, weeklyBudget: 40, monthlyBudget: 50 }],
    90,
    now,
  );

  assert.equal(indicators[0]?.provider, "openAI");
  const [daily, weekly, monthly] = indicators[0]?.periods ?? [];
  assert.equal(daily?.pricedEvents, 1);
  assert.equal(weekly?.pricedEvents, 2);
  assert.equal(monthly?.pricedEvents, 3);
  assert.ok((daily?.spentCny ?? 0) > 0);
  assert.ok((weekly?.spentCny ?? 0) > (daily?.spentCny ?? 0));
  assert.ok((monthly?.spentCny ?? 0) > (weekly?.spentCny ?? 0));
  assert.equal(daily?.state, "normal");
  assert.equal(weekly?.state, "warning");
  assert.equal(monthly?.state, "exceeded");
});

test("未知价格不会作为零费用宣称完整，混合价格保留已知下限", () => {
  const now = new Date("2026-07-28T12:00:00+08:00");
  const [unknownOnly] = buildProviderBudgetIndicators(
    [event("unknown-model", "codex", { provider: "私有服务" })],
    [{ provider: "私有服务", dailyBudget: 100, weeklyBudget: 100, monthlyBudget: 100 }],
    80,
    now,
  );
  assert.equal(unknownOnly?.periods[0]?.pricedEvents, 0);
  assert.equal(unknownOnly?.periods[0]?.unknownEvents, 1);
  assert.equal(unknownOnly?.periods[0]?.hasUnknownCost, true);

  const [mixed] = buildProviderBudgetIndicators(
    [
      event("gpt-5.4", "codex", { provider: "OpenAI" }),
      event("unknown-model", "codex", { provider: "OpenAI" }),
    ],
    [{ provider: "openai", dailyBudget: 100, weeklyBudget: 100, monthlyBudget: 100 }],
    80,
    now,
  );
  assert.equal(mixed?.periods[0]?.pricedEvents, 1);
  assert.equal(mixed?.periods[0]?.unknownEvents, 1);
  assert.ok((mixed?.periods[0]?.spentCny ?? 0) > 0);
});

test("首页安全卡复用每日计数并展示剩余额度", () => {
  const now = new Date("2026-07-28T12:00:00+08:00");
  const storage = {
    getItem: () => JSON.stringify({ date: "2026-07-28", count: 3 }),
  };

  assert.equal(readRemainingSecurityScans(storage, now), 7);
  assert.equal(
    readRemainingSecurityScans(
      { getItem: () => JSON.stringify({ date: "2026-07-28", count: 12 }) },
      now,
    ),
    0,
  );
  assert.equal(readRemainingSecurityScans(undefined, now), null);
});
