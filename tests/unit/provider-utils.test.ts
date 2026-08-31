import assert from "node:assert/strict";
import test from "node:test";

import type {
  LocalUsageEvent,
  LocalUsageSource,
} from "../../src/lib/local-usage/types.ts";
import { resolveEventProvider } from "../../src/lib/local-usage/provider-utils.ts";

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
    resolveEventProvider(
      event("任意模型", "codex", { provider: "  自建服务  " }),
    ),
    "自建服务",
  );
  assert.equal(resolveEventProvider(event("claude-3-5-sonnet")), "Anthropic");
  assert.equal(resolveEventProvider(event("GPT-4o")), "OpenAI");
  assert.equal(resolveEventProvider(event("o3-mini")), "OpenAI");
  assert.equal(resolveEventProvider(event("Gemini-2.5-pro")), "Google");
  assert.equal(resolveEventProvider(event("deepseek-chat")), "DeepSeek");
  assert.equal(resolveEventProvider(event("Kimi-K2")), "Moonshot");
  assert.equal(resolveEventProvider(event("grok-4")), "xAI");
  assert.equal(resolveEventProvider(event("本地未知模型", "zed")), "zed");
});
