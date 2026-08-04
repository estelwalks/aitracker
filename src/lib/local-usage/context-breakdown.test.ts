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

test("多个工具按 calls 权重分摊完整事件 token（模型 A）", () => {
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

  // 模型 A：工具分摊完整事件 token（input+cache+output），两工具合计 = total
  const toolSum = result.tools.reduce((sum, row) => sum + row.totalTokens, 0);
  assert.equal(toolSum, 101);
  assert.equal(
    result.categories.reduce((sum, row) => sum + row.totalTokens, 0),
    101,
  );
  // calls 权重 2:1 → exec_command ≈ 67, web_search ≈ 34
  assert.ok(result.tools[0]?.totalTokens >= 60);
  // 工具含 input（模型 A：完整 token 归因）
  assert.ok(result.tools[0]!.inputTokens > 0);
});

test("纯文本响应：完整 token 归 messages text_response", () => {
  const result = buildContextBreakdown([event()]);
  const textRow = result.messages.find((r) => r.key === "text_response");
  assert.ok(textRow);
  assert.equal(textRow?.totalTokens, 101);
  // messageRoles 仍按角色分 input（独立视图）
  const userInput = result.messageRoles.find((r) => r.key === "user_input");
  assert.equal(userInput?.totalTokens, 50);
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

  // 模型 A：exec_command 与 tool_search 各分 ~50（calls 1:1），skill 从
  // tool_search 归因，command 从 exec_command 归因
  assert.equal(result.skills[0]?.key, "release-check");
  assert.ok(result.skills[0]?.totalTokens >= 49);
  assert.equal(result.commands[0]?.key, "npm · npm run");
  assert.ok(result.commands[0]?.totalTokens >= 49);
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
