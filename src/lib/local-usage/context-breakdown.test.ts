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

test("多个唯一工具均分 token，分类总额不会超过事件总量", () => {
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

  assert.equal(
    result.tools.reduce((sum, row) => sum + row.totalTokens, 0),
    101,
  );
  assert.equal(
    result.categories.reduce((sum, row) => sum + row.totalTokens, 0),
    101,
  );
  assert.equal(result.tools[0]?.totalTokens, 51);
  assert.equal(result.tools[1]?.totalTokens, 50);
});

test("纯文本响应归入 messages，reasoning 只计一次", () => {
  const result = buildContextBreakdown([event()]);
  assert.equal(result.messages[0]?.key, "text_response");
  assert.equal(result.messages[0]?.totalTokens, 101);
  assert.equal(result.messages[0]?.outputTokens, 20);
  assert.equal(result.messages[0]?.reasoningOutputTokens, 11);
  assert.equal(
    result.messages[0]!.inputTokens +
      result.messages[0]!.cachedInputTokens +
      result.messages[0]!.outputTokens +
      result.messages[0]!.reasoningOutputTokens,
    result.messages[0]?.totalTokens,
  );
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
  assert.equal(result.skills[0]?.totalTokens, 50);
  assert.equal(result.commands[0]?.key, "npm · npm run");
  assert.equal(result.commands[0]?.totalTokens, 51);
});
