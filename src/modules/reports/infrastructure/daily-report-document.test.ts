import assert from "node:assert/strict";
import test from "node:test";

import { buildDailyReportDocument } from "./daily-report-document.ts";
import type { ReportContext } from "../contracts.ts";

test("daily report uses the fixed Markdown structure and supplied figures", () => {
  const context: ReportContext = {
    evidence: [],
    summary: "ignored by the deterministic renderer",
    stats: {
      periodLabel: "今日 2026-08-31",
      sessions: 2,
      turns: 10,
      tokens: 1_000_000,
      costUsd: 3,
      costCny: 21,
      edits: 0,
      durationMin: 75,
      bySource: [
        {
          source: "Codex",
          sessions: 2,
          tokens: 1_000_000,
          costUsd: 3,
          costCny: 21,
          edits: 0,
          durationMin: 75,
        },
      ],
      projects: ["aitracker"],
      byModel: [
        { model: "gpt-test", calls: 4, tokens: 1_000_000, costCny: 21 },
      ],
      byProject: [
        {
          label: "aitracker",
          kind: "project",
          sessions: 2,
          tokens: 1_000_000,
          source: "Codex",
        },
      ],
      sessionsDetail: [
        {
          title: "日报结构优化",
          project: "aitracker",
          source: "Codex",
          turns: 10,
          tokens: 1_000_000,
          durationMin: 75,
        },
      ],
      cache: {
        totalTokens: 1_000_000,
        inputTokens: 800_000,
        outputTokens: 200_000,
        reasoningTokens: 0,
        cachedTokens: 400_000,
        cacheHitRate: 0.5,
      },
    },
  };

  const body = buildDailyReportDocument(context);
  assert.match(body, /^# AITracker 日报/);
  assert.match(body, /## 今日概览/);
  assert.match(body, /## Agent 使用/);
  assert.match(body, /## 项目与对话/);
  assert.match(body, /## 会话排行/);
  assert.match(body, /## 模型使用/);
  assert.match(body, /## Token 与缓存/);
  assert.match(body, /## Skill 与安全/);
  assert.doesNotMatch(body, /今日暂无 AI 使用记录/);
  assert.match(body, /日报结构优化/);
  assert.match(body, /50\.0%/);
  assert.doesNotMatch(body, /ignored by the deterministic renderer/);

  const englishBody = buildDailyReportDocument(context, "en-US");
  assert.match(englishBody, /^# AITracker Daily Report/);
  assert.match(englishBody, /## Today's overview/);
  assert.doesNotMatch(englishBody, /今日概览|Agent 使用|今日关注/);
});

test("daily report has the exact empty-data output", () => {
  const body = buildDailyReportDocument({
    evidence: [],
    summary: "",
    stats: {
      periodLabel: "今日 2026-08-31",
      sessions: 0,
      turns: 0,
      tokens: 0,
      costUsd: 0,
      edits: 0,
      durationMin: 0,
      bySource: [],
      projects: [],
    },
  });
  assert.equal(body, "# AITracker 日报\n\n今日暂无 AI 使用记录。");
});

function workProfileContext(): ReportContext {
  return {
    evidence: [],
    summary: "ignored by the deterministic renderer",
    stats: {
      periodLabel: "今日 2026-08-31",
      sessions: 1,
      turns: 12,
      tokens: 500_000,
      costUsd: 1,
      costCny: 7,
      edits: 18,
      durationMin: 30,
      bySource: [
        {
          source: "codex",
          sessions: 1,
          tokens: 500_000,
          costUsd: 1,
          costCny: 7,
          edits: 18,
          durationMin: 30,
        },
      ],
      projects: ["aitracker"],
      behaviors: [
        {
          key: "execution",
          label: "代码生成/重构",
          tokenShare: 0.8,
          eventShare: 0.7,
        },
        { key: "qa", label: "对话/问答", tokenShare: 0.2, eventShare: 0.3 },
      ],
      toolUsageBySource: [
        {
          source: "codex",
          tools: [
            { name: "exec_command", calls: 120 },
            { name: "apply_patch", calls: 18 },
          ],
        },
      ],
      sessionsDetail: [
        {
          title: "拉取这个项目",
          project: "aitracker",
          source: "codex",
          turns: 12,
          tokens: 500_000,
          durationMin: 30,
        },
      ],
    },
  };
}

test("daily report renders a work profile grounded in real tool activity", () => {
  const body = buildDailyReportDocument(workProfileContext());
  assert.match(body, /## 工作画像/);
  assert.match(body, /行为构成/);
  assert.match(body, /代码生成\/重构 80\.0%/);
  assert.match(body, /主要工具行为/);
  assert.match(body, /exec_command ×120/);
  assert.match(body, /apply_patch ×18/);
  assert.match(body, /会话主题/);
  assert.match(body, /拉取这个项目/);
  // The work profile must sit before the numeric breakdowns so it reads first.
  assert.ok(
    body.indexOf("## 工作画像") < body.indexOf("## Agent 使用"),
    "work profile should precede the agent breakdown",
  );
});

test("daily work profile is localized and honest without tool signals", () => {
  const english = buildDailyReportDocument(workProfileContext(), "en-US");
  assert.match(english, /## Work profile/);
  assert.match(english, /Code generation\/refactor 80\.0%/);
  assert.match(english, /Top tool activity/);
  assert.match(english, /exec_command ×120/);

  const blank = workProfileContext();
  const stats = blank.stats!;
  const withoutTools: ReportContext = {
    ...blank,
    stats: {
      ...stats,
      behaviors: undefined,
      toolUsageBySource: undefined,
      sessionsDetail: undefined,
    },
  };
  const body = buildDailyReportDocument(withoutTools);
  assert.match(body, /## 工作画像/);
  assert.doesNotMatch(body, /exec_command/);
  assert.doesNotMatch(body, /行为构成/);
});

test("cross-period sessions are labelled instead of posing as period totals", () => {
  const base = workProfileContext();
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

  const body = buildDailyReportDocument(withCross);
  const start = body.indexOf("## 会话排行");
  const section = body.slice(start, body.indexOf("## 模型使用", start));
  assert.match(section, /\*\*101\.35M\*\*\\\*/u, "跨周期会话应带星号标注");
  assert.match(section, /整段会话累计/, "跨周期会话应给出脚注");

  // A contained session must stay unmarked.
  const contained = buildDailyReportDocument(base);
  assert.doesNotMatch(contained, /整段会话累计/);
});
