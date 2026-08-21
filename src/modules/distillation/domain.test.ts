import assert from "node:assert/strict";
import test from "node:test";

import type { AIExecutionResult } from "../ai-orchestration/contracts.ts";
import type { CandidateOutput } from "./contracts.ts";
import {
  candidateText,
  candidateTitle,
  controlledSessionSummary,
  safeText,
} from "./domain.ts";

const row = controlledSessionSummary(
  {
    sessionId: "s1",
    source: "codex",
    title: "Refactor session",
    projectKey: "demo",
    model: "model-a",
    startedAt: "2026-08-07T00:00:00.000Z",
    endedAt: "2026-08-07T00:01:00.000Z",
    durationMs: 60_000,
    turns: 3,
    editTurns: 1,
    retryTurns: 0,
    totals: {
      inputTokens: 1,
      outputTokens: 2,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 3,
    },
    cost: {
      knownUsd: 0,
      estimatedUsd: 0,
      cacheSavingsUsd: 0,
      pricedEvents: 0,
      estimatedEvents: 0,
      unknownEvents: 0,
      unknownModels: [],
      complete: true,
    },
    subagentCalls: 0,
    status: "available",
    statusReason: null,
    resumeAvailable: true,
  },
  { source: "codex", sessionId: "s1" },
);

const aiResult = (text: string): AIExecutionResult => ({
  summary: {
    requestId: "req-1",
    modelId: "offline",
    providerId: "offline",
    promptVersionId: "distill",
    promptVersion: 1,
    status: "offline",
    cost: { confidence: "unknown", currency: "USD", reason: "offline" },
    usedFallback: true,
  },
  response: { providerId: "offline", modelId: "offline", text },
});

test("candidateText keeps realistic developer prose for persona and task kinds", () => {
  const persona =
    "开发工程师画像：主力 node 与 npm 工程化，日常用 git 管理分支与 CI，偏好类型安全。";
  const task =
    "任务记录：用 npm 升级依赖、运行 lint 修复，并推进 monorepo 的迁移。";
  assert.equal(candidateText(aiResult(persona), [row], "persona"), persona);
  assert.equal(candidateText(aiResult(task), [row], "memory"), task);
});

test("candidateText redacts private fragments but keeps surrounding content", () => {
  const text =
    "偏好统计：在 /Users/gerry/ks_project 下工作，见过泄漏的 token=sk-live-abcdefghijklmnop，改用环境变量注入。";
  const output = candidateText(aiResult(text), [row], "persona");
  assert.doesNotMatch(output, /\/Users\//);
  assert.doesNotMatch(output, /sk-live-abcdefghijklmnop/);
  assert.match(output, /~/);
  assert.match(output, /\[REDACTED\]/);
  assert.match(output, /偏好统计/);
  assert.match(output, /环境变量注入/);
});

test("candidateText falls back for empty output and keeps redacted paths otherwise", () => {
  assert.equal(
    candidateText(aiResult(""), [row], "persona"),
    "Distilled persona memory for 1 selected session.",
  );
  // A path-bearing body is normalized to `~/` but never discarded.
  assert.equal(
    candidateText(aiResult("/Users/me/project"), [row], "memory"),
    "~/project",
  );
});

test("safeText sanitizes titles while keeping technical words", () => {
  assert.equal(safeText("Node 依赖重构复盘", 120), "Node 依赖重构复盘");
  assert.equal(safeText("npm 工程化最佳实践", 120), "npm 工程化最佳实践");
  assert.equal(safeText("/home/me/secrets", 120), "~/secrets");
  assert.equal(safeText("api_key=supersecretvalue123", 120), "[REDACTED]");
  assert.equal(safeText("", 120), "[REDACTED]");
});

test("candidateTitle keeps a technical session lead", () => {
  const titled = controlledSessionSummary(
    {
      sessionId: "s1",
      source: "codex",
      title: "git 分支整理与 npm 升级",
      projectKey: "demo",
      model: "model-a",
      startedAt: "2026-08-07T00:00:00.000Z",
      endedAt: "2026-08-07T00:01:00.000Z",
      durationMs: 60_000,
      turns: 3,
      editTurns: 1,
      retryTurns: 0,
      totals: {
        inputTokens: 1,
        outputTokens: 2,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 3,
      },
      cost: {
        knownUsd: 0,
        estimatedUsd: 0,
        cacheSavingsUsd: 0,
        pricedEvents: 0,
        estimatedEvents: 0,
        unknownEvents: 0,
        unknownModels: [],
        complete: true,
      },
      subagentCalls: 0,
      status: "available",
      statusReason: null,
      resumeAvailable: true,
    },
    { source: "codex", sessionId: "s1" },
  );
  // candidateTitle takes its lead from the project key; with none, it falls
  // back to the (safety-filtered) session title, which must survive intact.
  const noProject = { ...titled, projectKey: "" };
  const title = candidateTitle(
    [noProject],
    "persona" as CandidateOutput["kind"],
  );
  assert.match(title, /git 分支整理与 npm 升级/);
});
