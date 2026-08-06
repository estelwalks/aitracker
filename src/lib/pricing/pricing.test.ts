import assert from "node:assert/strict";
import test from "node:test";

import type { LocalUsageEvent } from "../local-usage";
import {
  aggregatePricedUsage,
  BUILTIN_RATES,
  convertUsd,
  currentRate,
  estimateEventCost,
  estimateUsageCost,
  filterEventsByPeriod,
  formatCostAmount,
  formatMoney,
  sourceName,
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

test("sourceName projects the registry name; unknown ids fall back (F6-T3)", () => {
  assert.equal(sourceName("claude-code"), "Claude Code");
  assert.equal(sourceName("codex"), "Codex CLI");
  assert.equal(sourceName("aipy"), "AiPy");
  assert.equal(sourceName("not-a-tool"), "not-a-tool");
});

test("区分输入、输出和缓存读取价格，推理 Token 不重复计费", () => {
  const cost = estimateEventCost(event());
  assert.equal(cost.knownUsd, 35.5);
  assert.equal(cost.cacheSavingsUsd, 4.5);
  assert.equal(cost.complete, true);
});

test("未知模型不会显示为零费用(格式化层返回 null, 文案由字典渲染)", () => {
  const cost = estimateEventCost(event({ model: "unknown-local-model" }));
  assert.equal(cost.knownUsd, 0);
  assert.equal(cost.unknownEvents, 1);
  assert.equal(cost.complete, false);
  assert.equal(formatCostAmount("zh-CN", cost, "CNY"), null);
});

test("已知与未知事件混合时保留已知小计", () => {
  const cost = estimateUsageCost([
    event(),
    event({ model: "unknown-local-model" }),
  ]);
  assert.equal(cost.knownUsd, 35.5);
  assert.equal(cost.pricedEvents, 1);
  assert.equal(cost.unknownEvents, 1);
  // 金额可用时返回格式化金额(USD 展示, 避免默认汇率换算),部分未知标注由组件 t() 组合
  const amount = formatCostAmount("zh-CN", cost, "USD");
  assert.ok(amount != null && amount.includes("35.5"), amount ?? "null");
});

test("formatMoney: locale 只影响展示, 币种与换算不变", () => {
  // USD 原币种直出
  assert.equal(formatMoney("zh-CN", 12.34, "USD"), "US$12.34");
  assert.equal(formatMoney("en-US", 12.34, "USD"), "$12.34");
  // CNY 按默认汇率换算(12.34 × 7.2 = 88.848)
  assert.equal(formatMoney("zh-CN", 12.34, "CNY"), "¥88.848");
  // 显式汇率覆盖
  assert.equal(formatMoney("zh-CN", 10, "CNY", 7), "¥70.00");
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

test("convertUsd: 四币种换算与显式汇率覆盖, USD 直通", () => {
  assert.equal(convertUsd(10, "USD"), 10);
  assert.equal(convertUsd(10, "CNY", 7.2), 72);
  assert.equal(convertUsd(10, "JPY", 145), 1450);
  assert.equal(convertUsd(10, "KRW", 1350), 13500);
  assert.equal(convertUsd(10, "CNY"), 10 * BUILTIN_RATES.CNY);
});

test("currentRate: 无快照时用内置基准, USD 恒为 1", () => {
  assert.equal(currentRate("USD"), 1);
  assert.equal(currentRate("CNY"), BUILTIN_RATES.CNY);
  assert.equal(currentRate("JPY"), BUILTIN_RATES.JPY);
  assert.equal(currentRate("KRW"), BUILTIN_RATES.KRW);
});
