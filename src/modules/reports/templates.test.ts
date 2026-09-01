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
    /核心结论.*关键发现.*建议/u,
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
    /根据本次提供的周报数据.*上周数据时分析变化/u,
  );
  assert.match(
    aiSummaryTemplateFor("weekly", "en-US").template,
    /weekly report data.*last-week data is present/u,
  );
  assert.match(
    aiSummaryTemplateFor("monthly", "zh-CN").template,
    /根据本次提供的月报数据.*稳定的 AI 使用模式/u,
  );
  assert.match(
    aiSummaryTemplateFor("monthly", "en-US").template,
    /monthly report data.*stable AI usage patterns/u,
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

test("Chinese daily prompt is version 9", () => {
  const template = REPORT_TEMPLATES["zh-CN"].daily;
  assert.equal(template.version, 9);
  assert.equal(template.label, "Daily brief v9");
  assert.match(template.template, /AI 使用日报助手/);
  assert.match(template.template, /## 今日概览/);
  assert.match(template.template, /## Agent 使用/);
  assert.match(template.template, /## 项目与对话/);
  assert.match(template.template, /## 会话排行/);
  assert.match(template.template, /## 模型使用/);
  assert.match(template.template, /## Token 与缓存/);
  assert.match(template.template, /## 今日关注/);
  assert.match(template.template, /今日暂无 AI 使用记录/);
});
