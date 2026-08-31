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
