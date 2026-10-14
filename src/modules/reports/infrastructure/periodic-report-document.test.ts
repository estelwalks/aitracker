import assert from "node:assert/strict";
import test from "node:test";

import { buildPeriodicReportDocument } from "./periodic-report-document.ts";
import type { ReportContext, ReportStats } from "../contracts.ts";

function makeContext(outputs?: ReportStats["outputs"]): ReportContext {
  return {
    evidence: [],
    summary: "ignored by the deterministic renderer",
    stats: {
      periodLabel: "本周 2026-09-07 - 2026-09-13",
      sessions: 5,
      turns: 40,
      tokens: 4_000_000,
      costUsd: 12,
      costCny: 84,
      edits: 0,
      durationMin: 300,
      bySource: [
        {
          source: "Codex",
          sessions: 5,
          tokens: 4_000_000,
          costUsd: 12,
          costCny: 84,
          edits: 0,
          durationMin: 300,
        },
      ],
      projects: ["aitracker"],
      byModel: [
        { model: "gpt-test", calls: 20, tokens: 4_000_000, costCny: 84 },
      ],
      byProject: [
        {
          label: "aitracker",
          kind: "project",
          sessions: 5,
          tokens: 4_000_000,
          source: "Codex",
        },
      ],
      sessionsDetail: [
        {
          title: "周报结构优化",
          project: "aitracker",
          source: "Codex",
          turns: 40,
          tokens: 4_000_000,
          durationMin: 300,
        },
      ],
      ...(outputs === undefined ? {} : { outputs }),
    },
  };
}

test("weekly report renders a real accumulation section when outputs exist", () => {
  const body = buildPeriodicReportDocument(
    makeContext({ skills: 1, knowledge: 2, distillations: 0 }),
    "weekly",
  );
  assert.match(body, /## 沉淀与产出/);
  assert.match(body, /新增 Skill：1 个/);
  assert.match(body, /记忆\/知识：2 个/);
  // 零计数项不出现，也不出现“暂无”
  assert.doesNotMatch(body, /蒸馏成果：0 个/);
  assert.doesNotMatch(body, /本时段暂无明确的新增沉淀/);
});

test("monthly report renders a real accumulation section when outputs exist", () => {
  const body = buildPeriodicReportDocument(
    makeContext({ skills: 0, knowledge: 1, distillations: 3 }),
    "monthly",
  );
  assert.match(body, /## 沉淀与产出/);
  assert.match(body, /记忆\/知识：1 个/);
  assert.match(body, /蒸馏成果：3 个/);
  assert.doesNotMatch(body, /新增 Skill：0 个/);
  assert.doesNotMatch(body, /本时段暂无明确的新增沉淀/);
});

test("weekly report shows the empty message when outputs are all zero (no fabrication)", () => {
  const body = buildPeriodicReportDocument(
    makeContext({ skills: 0, knowledge: 0, distillations: 0 }),
    "weekly",
  );
  assert.match(body, /## 沉淀与产出/);
  assert.match(body, /本时段暂无明确的新增沉淀/);
  assert.doesNotMatch(body, /新增 Skill/);
  assert.doesNotMatch(body, /记忆\/知识：/);
  assert.doesNotMatch(body, /蒸馏成果：/);
});

test("periodic report omits the accumulation section when outputs are not provided", () => {
  const body = buildPeriodicReportDocument(makeContext(undefined), "weekly");
  assert.doesNotMatch(body, /## 沉淀与产出/);
  assert.doesNotMatch(body, /本时段暂无明确的新增沉淀/);
  assert.doesNotMatch(body, /新增 Skill/);
});

test("outputs section is localized (en-US)", () => {
  const body = buildPeriodicReportDocument(
    makeContext({ skills: 2, knowledge: 0, distillations: 1 }),
    "weekly",
    "en-US",
  );
  assert.match(body, /## Accumulated outputs/);
  assert.match(body, /New skills: 2/);
  assert.match(body, /Distillations: 1/);
  assert.doesNotMatch(body, /Memory\/knowledge: 0/);
});

function workContext(): ReportContext {
  const base = makeContext();
  const stats = base.stats!;
  return {
    ...base,
    stats: {
      ...stats,
      behaviors: [
        {
          key: "research",
          label: "工具调用/研究",
          tokenShare: 0.6,
          eventShare: 0.5,
        },
        {
          key: "execution",
          label: "代码生成/重构",
          tokenShare: 0.4,
          eventShare: 0.5,
        },
      ],
      toolUsageBySource: [
        {
          source: "codex",
          tools: [
            { name: "exec_command", calls: 955 },
            { name: "update_plan", calls: 26 },
          ],
        },
      ],
    },
  };
}

test("weekly report renders a localized work profile", () => {
  const zh = buildPeriodicReportDocument(workContext(), "weekly", "zh-CN");
  assert.match(zh, /## 工作画像/);
  assert.match(zh, /行为构成/);
  assert.match(zh, /工具调用\/研究 60\.0%/);
  assert.match(zh, /主要工具行为/);
  assert.match(zh, /exec_command ×955/);
  assert.match(zh, /会话主题/);
  assert.match(zh, /周报结构优化/);
  // The work profile is the first thing after the overview.
  assert.ok(
    zh.indexOf("## 工作画像") < zh.indexOf("## Agent 使用"),
    "work profile should precede the agent breakdown",
  );

  const en = buildPeriodicReportDocument(workContext(), "weekly", "en-US");
  assert.match(en, /## Work profile/);
  assert.match(en, /Tool use\/research 60\.0%/);
  assert.match(en, /exec_command ×955/);

  const monthly = buildPeriodicReportDocument(
    workContext(),
    "monthly",
    "zh-CN",
  );
  assert.match(monthly, /## 工作画像/);
  assert.match(monthly, /exec_command ×955/);
});

test("periodic work profile stays honest without any tool signal", () => {
  const blank = makeContext();
  const stats = blank.stats!;
  const body = buildPeriodicReportDocument(
    {
      ...blank,
      stats: {
        ...stats,
        behaviors: undefined,
        toolUsageBySource: undefined,
        sessionsDetail: undefined,
      },
    },
    "weekly",
    "zh-CN",
  );
  assert.match(body, /## 工作画像/);
  assert.doesNotMatch(body, /exec_command/);
  assert.doesNotMatch(body, /行为构成/);
  assert.match(body, /本时段未采集到工具行为/);
});

test("weekly sessions that run past the period are labelled", () => {
  const base = workContext();
  const stats = base.stats!;
  const withCross: ReportContext = {
    ...base,
    stats: {
      ...stats,
      sessionsDetail: [
        {
          ...stats.sessionsDetail![0]!,
          tokens: 101_350_000,
          crossPeriod: true,
        },
      ],
    },
  };

  const body = buildPeriodicReportDocument(withCross, "weekly", "zh-CN");
  const start = body.indexOf("## 会话");
  const section = body.slice(start, body.indexOf("## 模型使用", start));
  assert.match(section, /\*\*101\.35M\*\*\\\*/u, "跨周期会话应带星号标注");
  assert.match(section, /整段会话累计/, "跨周期会话应给出脚注");
  assert.doesNotMatch(
    buildPeriodicReportDocument(base, "weekly", "zh-CN"),
    /整段会话累计/,
  );
});
