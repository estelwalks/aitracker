import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyModelBehaviors,
  typicalCommandLatency,
} from "./behavior-classify.ts";
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

test("execution 事件归为代码生成/重构", () => {
  const behaviors = classifyModelBehaviors([
    event({
      context: {
        tools: [{ name: "apply_patch", category: "execution", calls: 1 }],
      },
    }),
  ]);
  assert.equal(behaviors[0]?.label, "代码生成/重构");
  assert.equal(behaviors[0]?.tokenShare, 1);
  assert.equal(behaviors[0]?.eventShare, 1);
});

test("调试命令签名优先于 execution 分类", () => {
  const behaviors = classifyModelBehaviors([
    event({
      context: {
        tools: [{ name: "exec_command", category: "execution", calls: 1 }],
        commands: [
          {
            kind: "exec_command",
            executable: "git",
            safeSignature: "git diff",
            duration: "1s-10s",
            outputSize: "under-1k",
            exitStatus: "success",
            calls: 1,
          },
        ],
      },
    }),
  ]);
  assert.equal(behaviors[0]?.label, "调试");
});

test("无工具纯文本事件归为对话/问答", () => {
  const behaviors = classifyModelBehaviors([event()]);
  assert.equal(behaviors[0]?.label, "对话/问答");
});

test("空事件返回空数组；多事件按 token 占比归一化", () => {
  assert.deepEqual(classifyModelBehaviors([]), []);

  const behaviors = classifyModelBehaviors([
    event({
      totalTokens: 300,
      context: {
        tools: [{ name: "apply_patch", category: "execution", calls: 1 }],
      },
    }),
    event({
      totalTokens: 100,
      context: {
        tools: [{ name: "web_search", category: "browser", calls: 1 }],
      },
    }),
  ]);
  const exec = behaviors.find((b) => b.label === "代码生成/重构");
  const research = behaviors.find((b) => b.label === "工具调用/研究");
  assert.ok(exec && research);
  assert.equal(exec?.tokenShare, 0.75);
  assert.equal(research?.tokenShare, 0.25);
  assert.equal(exec?.eventShare, 0.5);
});

test("typicalCommandLatency 取众数分桶；无 context 返回 null", () => {
  assert.equal(typicalCommandLatency([event()]), null);

  const withCommands: LocalUsageEvent = event({
    context: {
      tools: [{ name: "exec_command", category: "execution", calls: 3 }],
      commands: [
        {
          kind: "exec_command",
          executable: "npm",
          safeSignature: "npm run",
          duration: "1s-10s",
          outputSize: "under-1k",
          exitStatus: "success",
          calls: 2,
        },
        {
          kind: "exec_command",
          executable: "git",
          safeSignature: "git status",
          duration: "under-1s",
          outputSize: "under-1k",
          exitStatus: "success",
          calls: 1,
        },
      ],
    },
  });
  // 1s-10s appears 2 times > under-1s 1 time
  assert.equal(typicalCommandLatency([withCommands]), "1–10s");
});
