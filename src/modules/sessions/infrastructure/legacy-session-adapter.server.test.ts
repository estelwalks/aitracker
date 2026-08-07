import assert from "node:assert/strict";
import test from "node:test";

import {
  createLegacyResumeSessionPort,
  toPublicSession,
} from "./legacy-session-adapter.server.ts";
import type { SessionRecord } from "../../../lib/local-sessions/types.ts";
import { isErr } from "../../../shared/result.ts";

test("resume rejects unsafe ids without invoking executor", async () => {
  let invoked = false;
  const port = createLegacyResumeSessionPort({
    execute: async () => {
      invoked = true;
    },
  });
  const result = await port.resume({
    source: "codex",
    sessionId: "bad;rm -rf",
  });
  assert.equal(isErr(result), true);
  assert.equal(invoked, false);
  if (isErr(result))
    assert.equal(result.error.code, "errors.sessions.resumeInvalid");
});

test("resume result never contains a command or path", () => {
  const serialized = JSON.stringify({
    accepted: true,
    source: "codex",
    sessionId: "abc",
  });
  assert.doesNotMatch(serialized, /command|cwd|path|resumeCommand/);
});

function resumableRecord(): SessionRecord {
  return {
    source: "codex",
    sessionId: "abc",
    title: "demo",
    projectKey: "demo",
    projectRef: "/private/demo",
    model: null,
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:00:00.000Z",
    durationMs: 0,
    turns: 0,
    editTurns: 0,
    retryTurns: 0,
    totals: {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
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
    resumeSafe: true,
    resumeCommand: "codex resume abc",
  };
}

test("legacy projection strips private session fields", () => {
  const publicView = toPublicSession(resumableRecord());
  const serialized = JSON.stringify(publicView);
  assert.doesNotMatch(
    serialized,
    /projectRef|resumeCommand|command|prompt|response|transcript/,
  );
  assert.equal(publicView.projectKey, "demo");
  assert.equal(publicView.resumeAvailable, true);
});

test("resume maps executor failure and cancellation to stable codes", async () => {
  const scanner = { scan: async () => [resumableRecord()] };
  const failed = createLegacyResumeSessionPort(
    {
      execute: async () => {
        throw new Error("private");
      },
    },
    { scanner },
  );
  const failure = await failed.resume({ source: "codex", sessionId: "abc" });
  assert.equal(isErr(failure), true);
  if (isErr(failure))
    assert.equal(failure.error.code, "errors.sessions.resumeFailed");

  const controller = new AbortController();
  controller.abort();
  const cancelled = await createLegacyResumeSessionPort(
    { execute: async () => {} },
    { scanner },
  ).resume({ source: "codex", sessionId: "abc", signal: controller.signal });
  assert.equal(isErr(cancelled), true);
  if (isErr(cancelled))
    assert.equal(cancelled.error.code, "errors.sessions.resumeCancelled");
});
