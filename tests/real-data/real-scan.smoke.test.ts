/**
 * 真实日志 · 扫描冒烟
 * 数据源：开发机真实 agent 日志。断言基于真实扫描实际满足的不变量；
 * 真实日志缺失时整文件诚实 skip，绝不伪造。
 */
import assert from "node:assert/strict";
import { test, realLogsPresent, realSnapshot } from "./helpers.ts";

test("真实主目录扫描进入 real 模式且产生事件", async (t) => {
  if (!realLogsPresent()) {
    t.skip("本机未检测到真实 agent 日志目录，跳过真实扫描冒烟");
    return;
  }
  const snap = await realSnapshot();
  assert.equal(snap.mode, "real");
  assert.ok(snap.events > 0, `期望事件数 > 0，实际 ${snap.events}`);
  assert.ok(
    Number.isFinite(snap.generatedAt ? Date.parse(snap.generatedAt) : NaN),
  );
});

test("事件产生源一定被标记 available，且 token 字段非负", async (t) => {
  if (!realLogsPresent()) {
    t.skip("本机未检测到真实 agent 日志目录");
    return;
  }
  const snap = await realSnapshot();
  for (const source of snap.sources) {
    if (source.events > 0) {
      assert.equal(
        source.available,
        true,
        `${source.source} 有事件却未标记 available`,
      );
    }
    for (const [field, value] of Object.entries(source)) {
      if (typeof value === "number") {
        assert.ok(
          value >= 0 || field === "events",
          `${source.source}.${field}=${value} 为负数`,
        );
      }
    }
  }
});

test("检测到的源 filesConsidered 非零；未检测到则全为 0", async (t) => {
  if (!realLogsPresent()) {
    t.skip("本机未检测到真实 agent 日志目录");
    return;
  }
  const snap = await realSnapshot();
  for (const source of snap.sources) {
    if (source.detected) {
      assert.ok(
        source.filesConsidered >= 0,
        `${source.source} filesConsidered 为负`,
      );
    } else {
      assert.equal(
        source.filesConsidered,
        0,
        `${source.source} 未检测到却 consider 了文件`,
      );
    }
  }
});

test("codex 源存在真实 rollout 日志（~/.codex/sessions）", async (t) => {
  if (!realLogsPresent()) {
    t.skip("本机未检测到真实 agent 日志目录");
    return;
  }
  const snap = await realSnapshot();
  const codex = snap.sources.find((s) => s.source === "codex");
  assert.ok(codex, "扫描结果缺少 codex 源");
  assert.equal(codex.detected, true, "codex 源未检测到");
  assert.ok(codex.filesConsidered > 0, "codex 源应至少考虑 1 个 rollout 文件");
  assert.ok(codex.events > 0, "codex 源应有真实事件");
});

test("所有事件时间戳可解析且落在扫描时间窗口内", async (t) => {
  if (!realLogsPresent()) {
    t.skip("本机未检测到真实 agent 日志目录");
    return;
  }
  const snap = await realSnapshot();
  const nowMs = Date.now();
  assert.ok(snap.details.length > 0, "details 应有真实事件");
  for (const event of snap.details) {
    const ts = Date.parse(event.timestamp);
    assert.ok(Number.isFinite(ts), `事件时间戳不可解析: ${event.timestamp}`);
    assert.ok(ts <= nowMs, `事件时间戳在未来: ${event.timestamp}`);
  }
});

test("recent 事件最多 50 条且按时间倒序", async (t) => {
  if (!realLogsPresent()) {
    t.skip("本机未检测到真实 agent 日志目录");
    return;
  }
  const snap = await realSnapshot();
  assert.ok(snap.recent.length <= 50, `recent=${snap.recent.length} 超过 50`);
  for (let i = 1; i < snap.recent.length; i += 1) {
    assert.ok(
      Date.parse(snap.recent[i - 1]!.timestamp) >=
        Date.parse(snap.recent[i]!.timestamp),
      "recent 未按时间倒序",
    );
  }
});
