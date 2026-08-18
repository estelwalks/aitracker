import assert from "node:assert/strict";
import test from "node:test";

import { CancelledError, isCancellation, withTimeout } from "./abort.ts";

test("withTimeout aborts when the timeout fires", async () => {
  const combined = withTimeout(undefined, 10);
  try {
    assert.equal(combined.signal.aborted, false);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(combined.signal.aborted, true);
    assert.equal(combined.cause, "timeout");
  } finally {
    combined.dispose();
  }
});

test("withTimeout aborts when the parent aborts (user cancel)", async () => {
  const parent = new AbortController();
  const combined = withTimeout(parent.signal, 10_000);
  try {
    parent.abort();
    assert.equal(combined.signal.aborted, true);
    assert.equal(combined.cause, "user");
  } finally {
    combined.dispose();
  }
});

test("withTimeout handles an already-aborted parent immediately", () => {
  const parent = new AbortController();
  parent.abort();
  const combined = withTimeout(parent.signal, 10_000);
  assert.equal(combined.signal.aborted, true);
  assert.equal(combined.cause, "user");
  combined.dispose();
});

test("dispose releases the timer (no late abort)", async () => {
  const combined = withTimeout(undefined, 10);
  combined.dispose();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(combined.signal.aborted, false);
});

test("isCancellation recognizes AbortError and CancelledError", () => {
  assert.equal(isCancellation(new CancelledError("user")), true);
  assert.equal(isCancellation(new CancelledError("timeout")), true);
  assert.equal(isCancellation(new DOMException("aborted", "AbortError")), true);
  assert.equal(isCancellation(new Error("boom")), false);
});
