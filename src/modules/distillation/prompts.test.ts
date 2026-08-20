import assert from "node:assert/strict";
import test from "node:test";

import { promptForKind } from "./prompts.ts";

test("skill prompt includes the provided role spec and XML requirement", () => {
  const prompt = promptForKind("skill");
  assert.match(prompt, /你是一个世界顶级的 AI Agent 架构师/);
  assert.match(prompt, /直接从第一行 <folder .*?> 开始/);
  assert.match(prompt, /参数闭环铁律/);
});

test("workflow prompt asks for a complete reusable workflow structure", () => {
  const prompt = promptForKind("brief");
  assert.match(prompt, /# 概述/);
  assert.match(prompt, /## 工作流步骤/);
  assert.match(prompt, /\{\{task_goal\}\}/);
  assert.match(
    prompt,
    /异常处理必须覆盖 fallback、降级方案、重试条件、人工接管信号/,
  );
});

test("custom user prompt is appended after the built-in template", () => {
  const prompt = promptForKind("memory", "保留风险清单");
  assert.match(prompt, /## 推荐下一步/);
  assert.match(prompt, /用户补充要求：\n保留风险清单/);
});
