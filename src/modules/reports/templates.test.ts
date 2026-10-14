import assert from "node:assert/strict";
import test from "node:test";

import { LOCALES } from "../../lib/i18n/locale";
import {
  aiSummaryTemplateFor,
  REPORT_TEMPLATES,
  templateFor,
  templateSetFor,
} from "./templates.ts";

test("report prompt catalog contains one independent prompt for every cadence and locale", () => {
  const ids = new Set<string>();
  for (const locale of LOCALES) {
    for (const kind of ["daily", "weekly", "monthly"] as const) {
      const template = REPORT_TEMPLATES[locale][kind];
      assert.ok(template.template.length > 0);
      assert.equal(template, templateFor(kind, locale));
      assert.equal(ids.has(template.templateId), false);
      ids.add(template.templateId);
    }
  }
  assert.equal(ids.size, 12);
});

test("templateSetFor assembles all four locales for one report cadence", () => {
  const set = templateSetFor();
  for (const locale of LOCALES) {
    assert.equal(set[locale], REPORT_TEMPLATES[locale]);
  }
});

test("AI summary prompts are localized and require the fixed summary structure", () => {
  const ids = new Set<string>();
  for (const locale of LOCALES) {
    const template = aiSummaryTemplateFor("daily", locale);
    assert.equal(ids.has(template.templateId), false);
    assert.ok(template.template.length > 200);
    ids.add(template.templateId);
  }
  assert.match(
    aiSummaryTemplateFor("daily", "zh-CN").template,
    /当前系统语言是简体中文/u,
  );
  assert.match(
    aiSummaryTemplateFor("daily", "zh-CN").template,
    /核心结论[\s\S]*亮点[\s\S]*不足[\s\S]*建议/u,
  );
  assert.match(
    aiSummaryTemplateFor("daily", "zh-CN").template,
    /当输入包含「会话内容洞察」时，必须逐会话展开/u,
  );
  assert.match(
    aiSummaryTemplateFor("daily", "zh-CN").template,
    /不包含「会话内容洞察」时/u,
  );
  assert.match(
    aiSummaryTemplateFor("daily", "en-US").template,
    /current system language is English/u,
  );
  assert.match(
    aiSummaryTemplateFor("daily", "ja-JP").template,
    /システム言語は日本語/u,
  );
  assert.match(
    aiSummaryTemplateFor("daily", "ko-KR").template,
    /시스템 언어는 한국어/u,
  );
  assert.match(
    aiSummaryTemplateFor("weekly", "zh-CN").template,
    /有上周数据时分析变化/u,
  );
  assert.match(
    aiSummaryTemplateFor("weekly", "en-US").template,
    /previous-week data exists/u,
  );
  assert.match(
    aiSummaryTemplateFor("monthly", "zh-CN").template,
    /有上月数据时分析变化/u,
  );
  assert.match(
    aiSummaryTemplateFor("monthly", "en-US").template,
    /previous-month data exists/u,
  );
  assert.notEqual(
    aiSummaryTemplateFor("daily", "zh-CN").template,
    aiSummaryTemplateFor("weekly", "zh-CN").template,
  );
  assert.notEqual(
    aiSummaryTemplateFor("weekly", "zh-CN").template,
    aiSummaryTemplateFor("monthly", "zh-CN").template,
  );
});

test("weekly and monthly prompts are version 5 with grounded output guidance", () => {
  const weeklyTemplate = REPORT_TEMPLATES["zh-CN"].weekly;
  assert.equal(weeklyTemplate.version, 6);
  assert.equal(weeklyTemplate.label, "Weekly review v6");
  assert.match(weeklyTemplate.template, /## 沉淀与产出/);
  assert.match(
    weeklyTemplate.template,
    /沉淀与产出、重复工作信号只能依据输入中明确提供的数据/,
  );
  assert.match(weeklyTemplate.template, /禁止编造产出/);

  const monthlyTemplate = REPORT_TEMPLATES["zh-CN"].monthly;
  assert.equal(monthlyTemplate.version, 6);
  assert.equal(monthlyTemplate.label, "Monthly review v6");
  assert.match(monthlyTemplate.template, /## 本月沉淀/);
  assert.match(
    monthlyTemplate.template,
    /沉淀与产出、重复工作信号只能依据输入中明确提供的数据/,
  );
  assert.match(monthlyTemplate.template, /禁止编造产出/);
});

test("AI summary template versions reflect the prompt bumps", () => {
  assert.equal(aiSummaryTemplateFor("daily", "zh-CN").version, 6);
  assert.equal(
    aiSummaryTemplateFor("daily", "zh-CN").label,
    "AI summary daily v6",
  );
  assert.equal(aiSummaryTemplateFor("weekly", "zh-CN").version, 5);
  assert.equal(
    aiSummaryTemplateFor("weekly", "zh-CN").label,
    "AI summary weekly v5",
  );
  assert.equal(aiSummaryTemplateFor("monthly", "zh-CN").version, 5);
  assert.equal(
    aiSummaryTemplateFor("monthly", "zh-CN").label,
    "AI summary monthly v5",
  );
});

test("Chinese daily prompt is version 11 with work summary and highlights", () => {
  const template = REPORT_TEMPLATES["zh-CN"].daily;
  assert.equal(template.version, 12);
  assert.equal(template.label, "Daily brief v12");
  assert.match(template.template, /AI 使用日报助手/);
  assert.match(template.template, /## 今日概览/);
  assert.match(template.template, /## 今日工作内容/);
  assert.match(template.template, /## Agent 使用/);
  assert.match(template.template, /## 项目与对话/);
  assert.match(template.template, /## 会话排行/);
  assert.match(template.template, /## 模型使用/);
  assert.match(template.template, /## Token 与缓存/);
  assert.match(template.template, /## 亮点与不足/);
  assert.match(template.template, /## 今日关注/);
  assert.match(template.template, /禁止编造输入中没有的工作细节/);
  assert.match(template.template, /今日暂无 AI 使用记录/);
});

test("content-insight prompts demand a per-session walkthrough and a longer budget", () => {
  const daily = aiSummaryTemplateFor("daily", "zh-CN").template;
  assert.match(daily, /会话洞察/u);
  assert.match(daily, /400-700 字/u);
  assert.match(daily, /必须逐会话展开/u);

  const weekly = aiSummaryTemplateFor("weekly", "zh-CN").template;
  assert.match(weekly, /本周/u);
  assert.match(weekly, /700-1100 字/u);

  const monthly = aiSummaryTemplateFor("monthly", "zh-CN").template;
  assert.match(monthly, /本月/u);
  assert.match(monthly, /900-1400 字/u);

  // Every locale must carry the per-session section, not just the length budget.
  const sectionMarkers: Record<string, RegExp> = {
    "zh-CN": /会话洞察/u,
    "en-US": /Session insight/u,
    "ja-JP": /セッション別インサイト/u,
    "ko-KR": /세션별 인사이트/u,
  };
  for (const locale of LOCALES) {
    assert.match(
      aiSummaryTemplateFor("daily", locale).template,
      sectionMarkers[locale]!,
      locale,
    );
  }
});
