import assert from "node:assert/strict";
import test from "node:test";

import { buildContextBreakdown } from "./context-breakdown.ts";
import type { LocalUsageEvent } from "./types.ts";

function event(overrides: Partial<LocalUsageEvent> = {}): LocalUsageEvent {
  return {
    source: "codex",
    timestamp: "2026-07-27T12:00:00.000Z",
    model: "codex-test",
    project: "~/demo",
    inputTokens: 50,
    cachedInputTokens: 20,
    cacheCreationInputTokens: 0,
    outputTokens: 31,
    reasoningOutputTokens: 11,
    totalTokens: 101,
    ...overrides,
  };
}

test("多个工具按 calls 权重分摊 output，input 不计入工具", () => {
  const result = buildContextBreakdown([
    event({
      context: {
        tools: [
          { name: "exec_command", category: "execution", calls: 2 },
          { name: "web_search", category: "browser", calls: 1 },
        ],
      },
    }),
  ]);

  // 工具只分摊 output（31）减 reasoning（11）= 20；input/cached 不进工具
  const toolSum = result.tools.reduce((sum, row) => sum + row.totalTokens, 0);
  assert.equal(toolSum, 20);
  assert.equal(
    result.categories.reduce((sum, row) => sum + row.totalTokens, 0),
    20,
  );
  // calls 权重 2:1 → exec_command 13(或14), web_search 7(或6)
  assert.ok(result.tools[0]?.totalTokens >= 13);
  assert.ok(result.tools[1]?.totalTokens <= 7);
  // 工具的 input/cached 必须为 0（input 归 messageRoles）
  assert.equal(result.tools[0]?.inputTokens, 0);
  assert.equal(result.tools[0]?.cachedInputTokens, 0);
});

test("纯文本响应：output 归 messages，input 归 messageRoles", () => {
  const result = buildContextBreakdown([event()]);
  // 无工具：output(20，减 reasoning) 归 text_response
  const textRow = result.messages.find((r) => r.key === "text_response");
  assert.ok(textRow);
  assert.equal(textRow?.totalTokens, 20);
  assert.equal(textRow?.outputTokens, 20);
  // input/cached 在 messageRoles，不在 messages 聚合
  const userInput = result.messageRoles.find((r) => r.key === "user_input");
  assert.equal(userInput?.totalTokens, 50);
  const history = result.messageRoles.find(
    (r) => r.key === "conversation_history",
  );
  assert.equal(history?.totalTokens, 20);
});

test("Skill 与命令统计是工具归因的受限视图", () => {
  const result = buildContextBreakdown([
    event({
      context: {
        tools: [
          { name: "exec_command", category: "execution", calls: 1 },
          { name: "tool_search", category: "skills", calls: 1 },
        ],
        skills: [{ name: "release-check", calls: 1 }],
        commands: [
          {
            kind: "exec_command",
            executable: "npm",
            safeSignature: "npm run",
            duration: "1s-10s",
            outputSize: "under-1k",
            exitStatus: "success",
            calls: 1,
          },
        ],
      },
    }),
  ]);

  assert.equal(result.skills[0]?.key, "release-check");
  assert.equal(result.skills[0]?.totalTokens, 10);
  assert.equal(result.commands[0]?.key, "npm · npm run");
  assert.equal(result.commands[0]?.totalTokens, 10);
});

test("messageRoles 按缓存代理切分，总额等于事件总量", () => {
  const result = buildContextBreakdown([event()]);

  const byKey = new Map(result.messageRoles.map((row) => [row.key, row]));
  assert.equal(byKey.get("user_input")?.totalTokens, 50);
  assert.equal(byKey.get("conversation_history")?.totalTokens, 20);
  // output 31 − reasoning 11 = 20
  assert.equal(byKey.get("assistant_reply")?.totalTokens, 20);
  assert.equal(byKey.get("reasoning")?.totalTokens, 11);
  assert.equal(byKey.get("system_prefix"), undefined); // cacheCreationInputTokens=0

  assert.equal(
    result.messageRoles.reduce((sum, row) => sum + row.totalTokens, 0),
    101,
  );
});

test("messageRoles 在有多事件时合计等于所有事件总量", () => {
  const result = buildContextBreakdown([
    event(),
    event({
      cacheCreationInputTokens: 9,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 9,
    }),
  ]);

  // event1 contributes 101, event2 contributes system_prefix=9
  assert.equal(
    result.messageRoles.reduce((sum, row) => sum + row.totalTokens, 0),
    110,
  );
  const systemPrefix = result.messageRoles.find(
    (row) => row.key === "system_prefix",
  );
  assert.equal(systemPrefix?.totalTokens, 9);
});
