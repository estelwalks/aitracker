/**
 * 真实日志 · 聚合一致性
 * 用真实扫描结果验证聚合不变量：各维度加总必须等于 totals，
 * 排序、去重、token 自洽必须成立。这是「真实数据必须满足」的硬约束。
 */
import assert from "node:assert/strict";
import {
  test,
  realLogsPresent,
  realSnapshot,
  realCompactSnapshot,
} from "./helpers.ts";

function tokenSelfConsistent(counts: {
  inputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}): boolean {
  return (
    counts.totalTokens ===
    counts.inputTokens +
      counts.cachedInputTokens +
      counts.cacheCreationInputTokens +
      counts.outputTokens +
      counts.reasoningOutputTokens
  );
}

test("totals 的 token 各分项自洽（total = input+cached+creation+output+reasoning）", async (t) => {
  if (!realLogsPresent()) {
    t.skip("本机未检测到真实 agent 日志目录");
    return;
  }
  const snap = await realSnapshot();
  assert.ok(tokenSelfConsistent(snap.totals), "totals token 分项不自洽");
  for (const key of [
    "inputTokens",
    "cachedInputTokens",
    "cacheCreationInputTokens",
    "outputTokens",
    "reasoningOutputTokens",
    "totalTokens",
  ] as const) {
    assert.ok(snap.totals[key] >= 0, `totals.${key} 为负: ${snap.totals[key]}`);
  }
});

test("bySource 加总 == totals（事件数与各 token 分项）", async (t) => {
  if (!realLogsPresent()) {
    t.skip("本机未检测到真实 agent 日志目录");
    return;
  }
  const snap = await realSnapshot();
  const events = snap.bySource.reduce((a, x) => a + x.events, 0);
  const tokens = snap.bySource.reduce((a, x) => a + x.totalTokens, 0);
  const input = snap.bySource.reduce((a, x) => a + x.inputTokens, 0);
  const output = snap.bySource.reduce((a, x) => a + x.outputTokens, 0);
  assert.equal(events, snap.totals.events);
  assert.equal(tokens, snap.totals.totalTokens);
  assert.equal(input, snap.totals.inputTokens);
  assert.equal(output, snap.totals.outputTokens);
});

test("byModel 加总 == totals（事件数与 token）", async (t) => {
  if (!realLogsPresent()) {
    t.skip("本机未检测到真实 agent 日志目录");
    return;
  }
  const snap = await realSnapshot();
  const events = snap.byModel.reduce((a, x) => a + x.events, 0);
  const tokens = snap.byModel.reduce((a, x) => a + x.totalTokens, 0);
  assert.equal(events, snap.totals.events);
  assert.equal(tokens, snap.totals.totalTokens);
});

test("byProject 加总 == totals", async (t) => {
  if (!realLogsPresent()) {
    t.skip("本机未检测到真实 agent 日志目录");
    return;
  }
  const snap = await realSnapshot();
  const events = snap.byProject.reduce((a, x) => a + x.events, 0);
  const tokens = snap.byProject.reduce((a, x) => a + x.totalTokens, 0);
  assert.equal(events, snap.totals.events);
  assert.equal(tokens, snap.totals.totalTokens);
});

test("daily 加总 == totals，日期升序且无重复", async (t) => {
  if (!realLogsPresent()) {
    t.skip("本机未检测到真实 agent 日志目录");
    return;
  }
  const snap = await realSnapshot();
  assert.ok(snap.daily.length > 0, "daily 应为空（有真实事件）");
  const events = snap.daily.reduce((a, x) => a + x.events, 0);
  const tokens = snap.daily.reduce((a, x) => a + x.totalTokens, 0);
  assert.equal(events, snap.totals.events);
  assert.equal(tokens, snap.totals.totalTokens);
  const seen = new Set<string>();
  for (let i = 0; i < snap.daily.length; i += 1) {
    const day = snap.daily[i]!;
    assert.ok(
      /^\d{4}-\d{2}-\d{2}$/u.test(day.date),
      `日期格式异常: ${day.date}`,
    );
    assert.ok(!seen.has(day.date), `日期重复: ${day.date}`);
    seen.add(day.date);
    if (i > 0) {
      assert.ok(snap.daily[i - 1]!.date < day.date, "daily 未按日期升序");
    }
  }
});

test("bySource / byModel / byProject 按 token 降序", async (t) => {
  if (!realLogsPresent()) {
    t.skip("本机未检测到真实 agent 日志目录");
    return;
  }
  const snap = await realSnapshot();
  for (const dim of ["bySource", "byModel", "byProject"] as const) {
    const rows = snap[dim];
    for (let i = 1; i < rows.length; i += 1) {
      assert.ok(
        rows[i - 1]!.totalTokens >= rows[i]!.totalTokens,
        `${dim} 未按 token 降序`,
      );
    }
  }
});

test("compactUsageSnapshot 后 aggregateBuckets 加总 == totals", async (t) => {
  if (!realLogsPresent()) {
    t.skip("本机未检测到真实 agent 日志目录");
    return;
  }
  const dto = await realCompactSnapshot();
  assert.ok(dto.aggregateBuckets, "compact 后应生成 aggregateBuckets");
  assert.ok(dto.aggregateBuckets.length > 0, "aggregateBuckets 应为空");
  const buckets = dto.aggregateBuckets!;
  const events = buckets.reduce((a, x) => a + x.events, 0);
  const tokens = buckets.reduce((a, x) => a + x.totalTokens, 0);
  const input = buckets.reduce((a, x) => a + x.inputTokens, 0);
  assert.equal(events, dto.totals.events, "bucket 事件数 != totals");
  assert.equal(tokens, dto.totals.totalTokens, "bucket token != totals");
  assert.equal(input, dto.totals.inputTokens, "bucket input != totals");
  for (const bucket of buckets) {
    assert.ok(tokenSelfConsistent(bucket), "bucket token 分项不自洽");
    assert.ok(bucket.events > 0, "bucket events 应为正");
  }
});
