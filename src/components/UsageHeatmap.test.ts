import assert from "node:assert/strict";
import test from "node:test";

import type { LocalUsageEvent } from "../lib/local-usage";
import { UsageHeatmap } from "./UsageHeatmap";

function event(timestamp: string, totalTokens = 100): LocalUsageEvent {
  return {
    source: "codex",
    timestamp,
    model: "gpt-5.6-sol",
    project: "~/demo",
    inputTokens: totalTokens,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens,
  };
}

test("按本地星期与小时聚合为固定 7×24 网格", () => {
  const rows = UsageHeatmap.aggregateUsageHeatmap([
    event("2026-07-27T09:10:00", 100),
    event("2026-07-27T09:50:00", 250),
    event("2026-08-02T23:30:00", 400),
  ]);

  assert.equal(rows.length, 7);
  assert.ok(rows.every((row) => row.length === 24));
  assert.deepEqual(rows[0]?.[9], {
    weekday: 0,
    hour: 9,
    events: 2,
    totalTokens: 350,
  });
  assert.equal(rows[6]?.[23]?.events, 1);
  assert.equal(rows[6]?.[23]?.totalTokens, 400);
});

test("空事件和非法时间正常降级为空网格", () => {
  const rows = UsageHeatmap.aggregateUsageHeatmap([event("not-a-date")]);
  assert.equal(
    rows.flat().reduce((sum, cell) => sum + cell.events, 0),
    0,
  );
  assert.equal(
    rows.flat().reduce((sum, cell) => sum + cell.totalTokens, 0),
    0,
  );
});

test("预算状态区分正常、临界、达到上限和关闭", () => {
  const indicators = UsageHeatmap.buildBudgetIndicators(
    [
      { key: "daily", label: "今日", budgetCny: 100, spentCny: 60 },
      { key: "weekly", label: "本周", budgetCny: 100, spentCny: 90 },
      { key: "monthly", label: "本月", budgetCny: 100, spentCny: 100 },
      { key: "daily", label: "关闭", budgetCny: 0, spentCny: 10 },
    ],
    90,
  );

  assert.equal(indicators[0]?.state, "normal");
  assert.equal(indicators[1]?.state, "warning");
  assert.equal(indicators[2]?.state, "exceeded");
  assert.equal(indicators[3]?.state, "disabled");
});

test("预算金额只采用已知成本并标记未知价格事件", () => {
  const [indicator] = UsageHeatmap.buildBudgetIndicators(
    [
      {
        key: "daily",
        label: "今日",
        budgetCny: 20,
        spentCny: 10,
        unknownEvents: 2,
      },
    ],
    80,
  );

  assert.equal(indicator?.spentCny, 10);
  assert.equal(indicator?.percentage, 50);
  assert.equal(indicator?.hasUnknownCost, true);
});
