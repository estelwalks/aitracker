import assert from "node:assert/strict";
import test from "node:test";

import { LOCALES } from "../../lib/i18n/locale";
import { REPORT_TEMPLATES, templateFor, templateSetFor } from "./templates.ts";

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
