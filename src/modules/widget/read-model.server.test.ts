import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import type { DashboardSummaryReadModel } from "../dashboard/summary-contracts";
import {
  __resetWidgetReadModelServerCacheForTest,
  __setWidgetSummaryLoaderForTest,
  invalidateWidgetReadModelCacheForRevision,
  loadWidgetReadModel,
} from "./read-model.server";

function summary(revision: string): DashboardSummaryReadModel {
  const window = {
    hasData: true,
    totals: { totalTokens: 128, events: 2 },
    sessions: 1,
    activeTools: 1,
    estimatedCostUsd: null,
    cacheRate: 50,
    trend: [{ date: "2026-08-24", tokens: 128 }],
    tools: [{ id: "codex", name: "Codex", tokens: 128, events: 2 }],
  };
  return {
    revision,
    generatedAt: "2026-08-24T08:00:00.000Z",
    windows: { today: window, "7d": window, "30d": window, all: window },
    outputAvailability: {
      distillationOutputs: { available: true, count: 3 },
      dailyReports: { available: true, count: 2 },
    },
  } as unknown as DashboardSummaryReadModel;
}

afterEach(() => __resetWidgetReadModelServerCacheForTest());

test("concurrent renderer requests share one dashboard summary flight", async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  __setWidgetSummaryLoaderForTest(async () => {
    calls += 1;
    await gate;
    return summary("r1");
  });

  const first = loadWidgetReadModel("zh-CN");
  const second = loadWidgetReadModel("zh-CN");
  release();
  const [left, right] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.strictEqual(left, right);
});

test("matching revision reuses cache and changed revision invalidates it", async () => {
  let calls = 0;
  __setWidgetSummaryLoaderForTest(async () => {
    calls += 1;
    return summary(`r${calls}`);
  });

  const first = await loadWidgetReadModel("en-US");
  assert.equal(first.revision, "r1");
  assert.equal(invalidateWidgetReadModelCacheForRevision("en-US", "r1"), false);
  assert.strictEqual(await loadWidgetReadModel("en-US"), first);
  assert.equal(calls, 1);

  assert.equal(invalidateWidgetReadModelCacheForRevision("en-US", "r2"), true);
  const second = await loadWidgetReadModel("en-US");
  assert.equal(second.revision, "r2");
  assert.equal(calls, 2);
});
