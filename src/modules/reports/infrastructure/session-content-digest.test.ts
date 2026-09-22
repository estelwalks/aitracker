import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSessionContentDigest,
  redactSessionText,
  renderSessionDigest,
  type DigestMessage,
} from "./session-content-digest.ts";

const msg = (role: DigestMessage["role"], text: string): DigestMessage => ({
  role,
  text,
});

test("redacts paths, credentials and e-mail addresses", () => {
  const result = redactSessionText(
    "改 /Users/diffsec/Documents/app 里的配置，key: sk-abcdefgh12345678 发给 a@b.com 用 ~/secret/id_rsa",
  );
  assert.equal(result.redacted, true);
  assert.doesNotMatch(result.text, /\/Users\//u);
  assert.doesNotMatch(result.text, /sk-abcdefgh/u);
  assert.doesNotMatch(result.text, /a@b\.com/u);
  assert.doesNotMatch(result.text, /~\/secret/u);
  assert.match(result.text, /<path>|<secret>|<email>|<home>/u);
});

test("leaves ordinary prose untouched", () => {
  const result = redactSessionText("把日报改成按会话内容总结，并补一个开关");
  assert.equal(result.redacted, false);
  assert.equal(result.text, "把日报改成按会话内容总结，并补一个开关");
});

test("skips harness preambles and keeps real user asks", () => {
  const digest = buildSessionContentDigest("拉取这个项目", [
    msg("user", "<recommended_plugins> lots of injected noise"),
    msg("user", "# AGENTS.md instructions\nbehavioural guidelines"),
    msg("user", "拉取这个项目"),
    msg("assistant", "已开始拉取。"),
    msg("user", "网络没问题 你就从新开始拉取"),
    msg(
      "assistant",
      "拉取完成，正在分析代码结构、补齐文档并打包桌面端应用，随后启动应用做了真实端到端验证。",
    ),
  ]);
  assert.deepEqual(digest.goals, [
    "拉取这个项目",
    "网络没问题 你就从新开始拉取",
  ]);
  assert.deepEqual(digest.outcome, [
    "拉取完成，正在分析代码结构、补齐文档并打包桌面端应用，随后启动应用做了真实端到端验证。",
  ]);
  // The mid-session work shows up as progress rather than only as asks.
  assert.deepEqual(digest.progress, []);
});

test("samples user turns across a long session instead of only the head", () => {
  const messages: DigestMessage[] = [];
  for (let i = 0; i < 40; i += 1) {
    messages.push(msg("user", `第 ${i} 步的诉求`));
    messages.push(msg("assistant", `处理完第 ${i} 步。`));
  }
  const digest = buildSessionContentDigest("长会话", messages, { maxGoals: 4 });
  assert.equal(digest.goals.length, 4);
  assert.equal(digest.goals[0], "第 0 步的诉求");
  assert.equal(digest.goals[3], "第 39 步的诉求");
  // The middle of the session is represented, not just the opening.
  assert.ok(
    digest.goals.slice(1, 3).every((goal) => !goal.startsWith("第 0 ")),
  );
});

test("caps field length and never splits a placeholder", () => {
  const digest = buildSessionContentDigest(
    "标题",
    [msg("user", `/Users/diffsec/${"x".repeat(5000)}`)],
    { maxFieldChars: 60 },
  );
  assert.equal(digest.redacted, true);
  assert.ok(digest.goals[0]!.length <= 61);
  assert.doesNotMatch(digest.goals[0]!, /\/Users\//u);
});

test("renders an honest placeholder when nothing usable was found", () => {
  const digest = buildSessionContentDigest("空会话", [
    msg("user", "<system>noise"),
  ]);
  assert.match(renderSessionDigest(digest), /未提取到可用的会话内容/u);
});

test("sampled progress describes what was done, not only what was asked", () => {
  const messages: DigestMessage[] = [];
  for (let i = 0; i < 12; i += 1) {
    messages.push(msg("user", `第 ${i} 步：请继续推进这个任务`));
    messages.push(
      msg(
        "assistant",
        `第 ${i} 步已完成：补齐了文档、调整了接线并跑通了测试用例。`,
      ),
    );
  }
  const digest = buildSessionContentDigest("长会话", messages, {
    maxGoals: 4,
    maxProgress: 5,
    maxOutcome: 2,
  });
  assert.equal(digest.progress.length, 5);
  assert.ok(digest.progress.every((item) => item.includes("已完成")));
  assert.ok(digest.progress.every((item) => item.length <= 801));
});
