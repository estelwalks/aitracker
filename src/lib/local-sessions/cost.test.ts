import assert from "node:assert/strict";
import test from "node:test";

import { estimateSessionCost } from "./cost.ts";
import type { SessionRecord } from "./types.ts";

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionId: "safe-session-id",
    source: "claude-code",
    title: "",
    projectKey: "demo",
    projectRef: "/demo",
    model: "claude-sonnet-4",
    startedAt: "2026-08-01T00:00:00.000Z",
    endedAt: "2026-08-01T00:01:00.000Z",
    durationMs: 60_000,
    turns: 1,
    editTurns: 0,
    retryTurns: 0,
    totals: {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cachedInputTokens: 1_000_000,
      cacheCreationInputTokens: 1_000_000,
      reasoningOutputTokens: 50_000,
      totalTokens: 4_050_000,
    },
    cost: {
      knownUsd: 0,
      cacheSavingsUsd: 0,
      pricedEvents: 0,
      unknownEvents: 0,
      unknownModels: [],
      complete: true,
    },
    subagentCalls: 0,
    status: "available",
    statusReason: null,
    resumeSafe: true,
    resumeCommand: "claude --resume safe-session-id",
    ...overrides,
  };
}

test("会话费用按真实模型的输入、输出及缓存价计算，推理 Token 不重复计费", () => {
  const cost = estimateSessionCost(session());

  assert.equal(cost.knownUsd, 22.05);
  assert.equal(cost.cacheSavingsUsd, 2.7);
  assert.equal(cost.complete, true);
});

test("未知或缺失模型绝不伪装成零费用", () => {
  const unknown = estimateSessionCost(
    session({ model: "private-local-model" }),
  );
  const missing = estimateSessionCost(session({ model: null }));

  assert.equal(unknown.knownUsd, 0);
  assert.equal(unknown.complete, false);
  assert.equal(unknown.unknownEvents, 1);
  assert.equal(missing.knownUsd, 0);
  assert.equal(missing.complete, false);
  assert.equal(missing.unknownEvents, 1);
});

test("没有缓存写入单价时保留价格未知，避免低估会话费用", () => {
  const cost = estimateSessionCost(
    session({
      source: "codex",
      model: "gpt-5-codex",
      totals: {
        inputTokens: 10,
        outputTokens: 10,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 1,
        reasoningOutputTokens: 0,
        totalTokens: 21,
      },
    }),
  );

  assert.equal(cost.knownUsd, 0);
  assert.equal(cost.complete, false);
  assert.equal(cost.unknownEvents, 1);
});
