import assert from "node:assert/strict";
import test from "node:test";

import {
  isPrivateSessionId,
  sessionIdFromRelativeFile,
  sessionIdFromStructuredValue,
} from "./session-id.ts";

test("session ids are stable, opaque, and source scoped", () => {
  const structuredSecret = "thread-/Users/private/project-PROMPT_BODY";
  const first = sessionIdFromStructuredValue("claude-code", structuredSecret);
  const second = sessionIdFromStructuredValue("claude-code", structuredSecret);
  const otherSource = sessionIdFromStructuredValue("codex", structuredSecret);

  assert.equal(first, second);
  assert.notEqual(first, otherSource);
  assert.ok(isPrivateSessionId(first));
  assert.doesNotMatch(first ?? "", /Users|private|project|PROMPT|thread/);
});

test("file fallback is stable and distinguishes relative file identities", () => {
  const first = sessionIdFromRelativeFile(
    "codex",
    "sessions/2026/rollout-a.jsonl",
  );
  const repeat = sessionIdFromRelativeFile(
    "codex",
    "sessions/2026/rollout-a.jsonl",
  );
  const second = sessionIdFromRelativeFile(
    "codex",
    "sessions/2026/rollout-b.jsonl",
  );

  assert.equal(first, repeat);
  assert.notEqual(first, second);
  assert.ok(isPrivateSessionId(first));
  assert.doesNotMatch(first, /sessions|rollout|jsonl/);
});
