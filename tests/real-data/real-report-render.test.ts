/**
 * 真实日志 · 报告渲染
 * 用真实 context 渲染日报/周报/月报，验证章节完整、数字格式正常、
 * 无占位符/NaN/[object Object]，且真实数据下不落入「暂无数据」分支。
 */
import assert from "node:assert/strict";
import {
  test,
  realLogsPresent,
  realReportContext,
  activePeriods,
  activePeriodsForDate,
  lastToolActiveDate,
  lastWorkProfileDate,
} from "./helpers.ts";
import { buildDailyReportDocument } from "../../src/modules/reports/infrastructure/daily-report-document.ts";
import { buildPeriodicReportDocument } from "../../src/modules/reports/infrastructure/periodic-report-document.ts";

const NO_DATA_MARKERS = ["暂无数据", "暂无记录", "本机尚未扫描到会话记录"];

const GARBAGE = /(?:\[object Object\]|undefined|NaN(?!N)|Infinity)/u;

function checkBody(body: string, title: string): void {
  assert.ok(body.length > 0, `${title} 渲染为空`);
  assert.ok(
    !NO_DATA_MARKERS.some((marker) => body.includes(marker)),
    `${title} 落入暂无数据分支（真实数据应渲染真实内容）`,
  );
  assert.ok(!GARBAGE.test(body), `${title} 包含垃圾占位符`);
  assert.ok(!body.includes("undefined"), `${title} 包含 undefined`);
  // 渲染端安全文本不应含路径
  assert.ok(
    !/(?:\/Users\/|\/home\/|~\/|[A-Za-z]:\\|\\\\)/u.test(body),
    `${title} 包含路径`,
  );
}

test("日报用真实数据渲染完整章节", async (t) => {
  if (!realLogsPresent()) {
    t.skip("本机未检测到真实 agent 日志目录");
    return;
  }
  const periods = await activePeriods();
  const ctx = await realReportContext(
    periods.day.definition,
    periods.day.period,
  );
  assert.ok((ctx.stats?.tokens ?? 0) > 0, "日报周期应有真实 token");
  const body = buildDailyReportDocument(ctx);
  checkBody(body, "日报");
  for (const section of [
    "工作画像",
    "今日概览",
    "Agent 使用",
    "项目与对话",
    "模型使用",
    "Token 与缓存",
  ]) {
    assert.ok(body.includes(section), `日报缺少章节: ${section}`);
  }
});

test("周报用真实数据渲染完整章节", async (t) => {
  if (!realLogsPresent()) {
    t.skip("本机未检测到真实 agent 日志目录");
    return;
  }
  const periods = await activePeriods();
  const ctx = await realReportContext(
    periods.week.definition,
    periods.week.period,
  );
  assert.ok((ctx.stats?.tokens ?? 0) > 0, "周报周期应有真实 token");
  const body = buildPeriodicReportDocument(ctx, "weekly");
  checkBody(body, "周报");
  for (const section of [
    "工作画像",
    "概览",
    "Agent 使用",
    "项目与对话",
    "使用趋势",
    "会话",
  ]) {
    assert.ok(body.includes(section), `周报缺少章节: ${section}`);
  }
});

test("月报用真实数据渲染完整章节", async (t) => {
  if (!realLogsPresent()) {
    t.skip("本机未检测到真实 agent 日志目录");
    return;
  }
  const periods = await activePeriods();
  const ctx = await realReportContext(
    periods.month.definition,
    periods.month.period,
  );
  assert.ok((ctx.stats?.tokens ?? 0) > 0, "月报周期应有真实 token");
  const body = buildPeriodicReportDocument(ctx, "monthly");
  checkBody(body, "月报");
  for (const section of [
    "工作画像",
    "概览",
    "Agent 使用",
    "项目与对话",
    "使用趋势",
  ]) {
    assert.ok(body.includes(section), `月报缺少章节: ${section}`);
  }
});

test("日报上下文包含真实主要工具行为（脱敏汇总）", async (t) => {
  if (!realLogsPresent()) {
    t.skip("本机未检测到真实 agent 日志目录");
    return;
  }
  const date = await lastToolActiveDate();
  if (!date) {
    t.skip("本机没有已完成且包含工具调用的真实日志");
    return;
  }
  const periods = await activePeriodsForDate(date);
  const ctx = await realReportContext(
    periods.day.definition,
    periods.day.period,
  );
  assert.ok(
    (ctx.stats?.toolUsageBySource?.length ?? 0) > 0,
    "真实日报应包含按 Agent 的工具行为聚合",
  );
  assert.match(
    ctx.summary,
    /主要工具行为（脱敏汇总，按 Agent）/,
    "上下文摘要应包含主要工具行为章节",
  );
  // 每行形如「- codex：exec_command ×22、apply_patch ×3」
  assert.match(
    ctx.summary,
    /^- .+：.+ ×\d+/mu,
    "工具行为行应形如「- codex：exec_command ×22」",
  );
});

test("报告包含真实来源/模型/项目数字（非空表）", async (t) => {
  if (!realLogsPresent()) {
    t.skip("本机未检测到真实 agent 日志目录");
    return;
  }
  const periods = await activePeriods();
  const ctx = await realReportContext(
    periods.day.definition,
    periods.day.period,
  );
  assert.ok((ctx.stats?.bySource?.length ?? 0) > 0, "bySource 不应为空");
  assert.ok((ctx.stats?.byProject?.length ?? 0) > 0, "byProject 不应为空");
  const body = buildDailyReportDocument(ctx);
  assert.ok(body.includes("Tokens"), "日报未展示 Tokens 数字");
  assert.match(body, /¥[\d.,]+/u, "日报未展示成本");
});

test("日报工作画像携带真实工具行为与会话主题", async (t) => {
  if (!realLogsPresent()) {
    t.skip("本机未检测到真实 agent 日志目录");
    return;
  }
  const date = await lastWorkProfileDate();
  if (!date) {
    t.skip("本机没有同时包含工具调用和已落库会话的真实日志");
    return;
  }
  const periods = await activePeriodsForDate(date);
  const ctx = await realReportContext(
    periods.day.definition,
    periods.day.period,
  );
  assert.ok(
    (ctx.stats?.toolUsageBySource?.length ?? 0) > 0,
    "真实周期应有按 Agent 的工具聚合",
  );
  const body = buildDailyReportDocument(ctx);
  const start = body.indexOf("## 工作画像");
  assert.ok(start >= 0, "日报缺少工作画像章节");
  const end = body.indexOf("## Agent 使用", start);
  const section = body.slice(start, end === -1 ? undefined : end);
  assert.match(section, /主要工具行为/, "工作画像缺少主要工具行为");
  assert.match(section, /×\d+/u, "工具行为缺少真实调用次数");
  assert.match(section, /会话主题/, "工作画像缺少会话主题");
  // The configured model receives this exact document as its input, so the tool
  // activity has to live in the body — not only in the adapter context summary.
  const tool = ctx.stats!.toolUsageBySource![0]!.tools[0]!;
  assert.ok(
    section.includes(`${tool.name} ×${tool.calls}`),
    `工作画像未包含真实工具 ${tool.name} ×${tool.calls}`,
  );
});
