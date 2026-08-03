import assert from "node:assert/strict";
import test from "node:test";

import type { LocalUsageEvent } from "../local-usage";
import {
  aggregatePricedUsage,
  estimateEventCost,
  estimateUsageCost,
  filterEventsByPeriod,
  formatCost,
} from "./index";

function event(overrides: Partial<LocalUsageEvent> = {}): LocalUsageEvent {
  return {
    source: "codex",
    timestamp: "2026-07-27T10:00:00.000Z",
    model: "gpt-5.6-sol",
    project: "~/demo",
    inputTokens: 1_000_000,
    cachedInputTokens: 1_000_000,
    cacheCreationInputTokens: 0,
    outputTokens: 1_000_000,
    reasoningOutputTokens: 200_000,
    totalTokens: 3_000_000,
    ...overrides,
  };
}

test("区分输入、输出和缓存读取价格，推理 Token 不重复计费", () => {
  const cost = estimateEventCost(event());
  assert.equal(cost.knownUsd, 35.5);
  assert.equal(cost.cacheSavingsUsd, 4.5);
  assert.equal(cost.complete, true);
});

test("未知模型不会显示为零费用", () => {
  const cost = estimateEventCost(event({ model: "unknown-local-model" }));
  assert.equal(cost.knownUsd, 0);
  assert.equal(cost.unknownEvents, 1);
  assert.equal(cost.complete, false);
  assert.equal(formatCost(cost, "CNY"), "价格未知");
});

test("已知与未知事件混合时保留已知小计并明确部分未知", () => {
  const cost = estimateUsageCost([
    event(),
    event({ model: "unknown-local-model" }),
  ]);
  assert.equal(cost.knownUsd, 35.5);
  assert.equal(cost.pricedEvents, 1);
  assert.equal(cost.unknownEvents, 1);
  assert.match(formatCost(cost, "USD"), /部分未知/);
});

test("按模型和 Token 类型聚合真实事件", () => {
  const events = [
    event(),
    event({ model: "gpt-5.4", inputTokens: 10, totalTokens: 2_000_010 }),
  ];
  const models = aggregatePricedUsage(events, "model");
  const tokenTypes = aggregatePricedUsage(events, "tokenType");
  assert.equal(models.length, 2);
  assert.equal(
    tokenTypes.find((row) => row.key === "input")?.totalTokens,
    1_000_010,
  );
  assert.equal(
    tokenTypes.find((row) => row.key === "reasoning")?.totalTokens,
    400_000,
  );
});

test("本周从周一开始筛选", () => {
  const events = [
    event({ timestamp: "2026-07-19T10:00:00.000Z" }),
    event({ timestamp: "2026-07-20T10:00:00.000Z" }),
    event({ timestamp: "2026-07-27T10:00:00.000Z" }),
  ];
  const filtered = filterEventsByPeriod(
    events,
    "week",
    undefined,
    undefined,
    new Date("2026-07-27"),
  );
  assert.equal(filtered.length, 1);
});
