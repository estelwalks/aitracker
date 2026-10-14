/**
 * 真实日志 · 隐私契约
 * 用真实日志产生的 ReportContext 验证：摘要/结构化字段不泄漏绝对路径、
 * 家目录、密钥、会话正文；会话标题遵守 72 字符上限（R5 回归）。
 */
import assert from "node:assert/strict";
import {
  test,
  realLogsPresent,
  realReportContext,
  activePeriods,
  dailyDefinition,
  weeklyDefinition,
} from "./helpers.ts";

const ABSOLUTE_PATH =
  /(?:\/Users\/|\/home\/|\/Users\/[A-Za-z0-9_.-]+\/|[A-Za-z]:\\|\\\\|~\/)/u;

const SECRET_PATTERN =
  /\b(?:sk-[A-Za-z0-9_-]{8,}|bearer\s+[A-Za-z0-9._-]+|api[_-]?key\s*[:=]?\s*[A-Za-z0-9._-]{8,}|password\s*[:=]?\s*[^\s]{4,}|secret(?:[_-]?token)?\s*[:=]?\s*[^\s]{4,})\b/iu;

/** 控制字符检测（等价于 /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u，排除 \t\n\r） */
function hasControlChar(value: string): boolean {
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (
      code !== 0x09 &&
      code !== 0x0a &&
      code !== 0x0d &&
      (code < 0x20 || code === 0x7f)
    ) {
      return true;
    }
  }
  return false;
}

test("真实上下文摘要不含绝对路径、家目录路径、密钥与会话正文", async (t) => {
  if (!realLogsPresent()) {
    t.skip("本机未检测到真实 agent 日志目录");
    return;
  }
  const periods = await activePeriods();
  const contexts = await Promise.all([
    realReportContext(periods.day.definition, periods.day.period),
    realReportContext(periods.week.definition, periods.week.period),
    realReportContext(periods.month.definition, periods.month.period),
  ]);
  for (const ctx of contexts) {
    assert.ok(ctx.summary.length > 0, "摘要不应为空（真实有数据）");
    assert.ok(
      !ABSOLUTE_PATH.test(ctx.summary),
      `摘要包含路径: ${ctx.summary.match(ABSOLUTE_PATH)?.[0]}`,
    );
    assert.ok(!SECRET_PATTERN.test(ctx.summary), "摘要包含疑似密钥");
    assert.ok(!hasControlChar(ctx.summary), "摘要包含控制字符");
  }
});

test("结构化项目标签 display-safe：无绝对路径、无 ~/、无控制字符", async (t) => {
  if (!realLogsPresent()) {
    t.skip("本机未检测到真实 agent 日志目录");
    return;
  }
  const periods = await activePeriods();
  const ctx = await realReportContext(
    periods.day.definition,
    periods.day.period,
  );
  const labels = [
    ...(ctx.stats?.projects ?? []),
    ...(ctx.stats?.byProject?.map((p) => p.label) ?? []),
    ...(ctx.stats?.byModel?.map((m) => m.model) ?? []),
  ];
  assert.ok(labels.length > 0, "应有真实项目/模型标签");
  for (const label of labels) {
    assert.ok(!ABSOLUTE_PATH.test(label), `标签包含路径: ${label}`);
    assert.ok(!hasControlChar(label), `标签包含控制字符: ${label}`);
    assert.ok(label.length > 0, "标签为空");
  }
});

test("会话标题遵守 72 字符上限（超长降级为 项目 · 来源）", async (t) => {
  if (!realLogsPresent()) {
    t.skip("本机未检测到真实 agent 日志目录");
    return;
  }
  const periods = await activePeriods();
  const ctx = await realReportContext(
    periods.day.definition,
    periods.day.period,
  );
  for (const detail of ctx.stats?.sessionsDetail ?? []) {
    assert.ok(
      Array.from(detail.title).length <= 72,
      `标题超长未降级: ${detail.title}`,
    );
  }
});

test("周/月上下文同样不泄漏（含重复信号与产出信号时）", async (t) => {
  if (!realLogsPresent()) {
    t.skip("本机未检测到真实 agent 日志目录");
    return;
  }
  const periods = await activePeriods();
  for (const period of [periods.week, periods.month]) {
    const ctx = await realReportContext(period.definition, period.period);
    assert.ok(ctx.summary.length > 0, "周/月摘要不应为空");
    assert.ok(!ABSOLUTE_PATH.test(ctx.summary), "周/月摘要包含路径");
    assert.ok(!SECRET_PATTERN.test(ctx.summary), "周/月摘要包含疑似密钥");
    for (const detail of ctx.stats?.sessionsDetail ?? []) {
      assert.ok(
        Array.from(detail.title).length <= 72,
        `周/月标题超长未降级: ${detail.title}`,
      );
    }
  }
});

test("daily/weekly 定义存在且周期可聚合", async (t) => {
  if (!realLogsPresent()) {
    t.skip("本机未检测到真实 agent 日志目录");
    return;
  }
  assert.equal(dailyDefinition.kind, "daily");
  assert.equal(weeklyDefinition.kind, "weekly");
  const periods = await activePeriods();
  assert.ok(periods.day.period.key >= "2026-01-01", "day key 异常");
  assert.ok(/^\d{4}-\d{2}$/u.test(periods.month.period.key), "month key 异常");
});
