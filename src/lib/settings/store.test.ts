import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_SETTINGS, parseSettings } from "./store.ts";

test("returns defaults for invalid persisted settings", () => {
  assert.deepEqual(parseSettings("{"), DEFAULT_SETTINGS);
});

test("keeps valid directory settings and fixes trash window", () => {
  const settings = parseSettings(
    JSON.stringify({ memoryDirectories: ["/tmp/docs", 42], trashMinutes: 99 }),
  );
  assert.deepEqual(settings.memoryDirectories, ["/tmp/docs"]);
  assert.equal(settings.trashMinutes, 5);
});

test("keeps valid security rules and filters invalid patterns", () => {
  const settings = parseSettings(
    JSON.stringify({
      securityRules: [
        {
          id: "valid",
          name: "自定义危险参数",
          kind: "危险命令",
          pattern: "--danger",
          enabled: true,
        },
        {
          id: "invalid",
          name: "损坏规则",
          kind: "敏感信息",
          pattern: "[",
          enabled: true,
        },
      ],
    }),
  );

  assert.equal(settings.securityRules.length, 1);
  assert.equal(settings.securityRules[0]?.id, "valid");
});

test("旧版设置迁移时补充空的服务商预算", () => {
  const settings = parseSettings(JSON.stringify({ dailyBudget: 88 }));

  assert.equal(settings.dailyBudget, 88);
  assert.deepEqual(settings.providerBudgets, []);
});

test("服务商预算会修剪名称、忽略大小写去重并安全修复非法金额", () => {
  const settings = parseSettings(
    JSON.stringify({
      providerBudgets: [
        {
          provider: "  OpenAI  ",
          dailyBudget: 10,
          weeklyBudget: -1,
          monthlyBudget: "100",
        },
        { provider: "openai", dailyBudget: 99, weeklyBudget: 99, monthlyBudget: 99 },
        { provider: "   ", dailyBudget: 1, weeklyBudget: 2, monthlyBudget: 3 },
        null,
      ],
    }),
  );

  assert.deepEqual(settings.providerBudgets, [
    { provider: "OpenAI", dailyBudget: 10, weeklyBudget: 0, monthlyBudget: 0 },
  ]);
});
