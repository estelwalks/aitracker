import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import type { spawn } from "node:child_process";

import { createNodeResumeExecutor } from "./node-resume-executor.server.ts";

class FakeChild extends EventEmitter {
  unrefCalled = false;
  killCalled = false;

  unref(): this {
    this.unrefCalled = true;
    return this;
  }

  kill(): boolean {
    this.killCalled = true;
    return true;
  }
}

test("launches only the registered tokenized command without a shell", async () => {
  const calls: unknown[][] = [];
  const child = new FakeChild();
  const executor = createNodeResumeExecutor({
    spawn: ((...args: unknown[]) => {
      calls.push(args);
      queueMicrotask(() => child.emit("spawn"));
      return child;
    }) as unknown as typeof spawn,
    // Deterministic: bypass the login-shell PATH resolver for unit tests.
    resolveExecutable: async (file) => file,
  });

  await executor.execute({
    source: "codex",
    sessionId: "safe-id_01",
    cwd: "/Users/demo/project",
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.slice(0, 2), ["codex", ["resume", "safe-id_01"]]);
  assert.deepEqual(calls[0]?.[2], {
    detached: true,
    shell: false,
    stdio: "ignore",
    windowsHide: true,
    cwd: "/Users/demo/project",
  });
  assert.equal(child.unrefCalled, true);
});

test("uses the resolved executable path when the resolver returns one", async () => {
  const calls: unknown[][] = [];
  const child = new FakeChild();
  const executor = createNodeResumeExecutor({
    spawn: ((...args: unknown[]) => {
      calls.push(args);
      queueMicrotask(() => child.emit("spawn"));
      return child;
    }) as unknown as typeof spawn,
    resolveExecutable: async () => "/custom/bin/codex",
  });

  await executor.execute({
    source: "codex",
    sessionId: "safe-id_01",
    cwd: "/Users/demo/project",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.[0], "/custom/bin/codex");
  assert.deepEqual(calls[0]?.[1], ["resume", "safe-id_01"]);
});

test("rejects unregistered sources and unsafe ids before spawning", async () => {
  let calls = 0;
  const executor = createNodeResumeExecutor({
    spawn: (() => {
      calls += 1;
      throw new Error("must not spawn");
    }) as unknown as typeof spawn,
  });

  await assert.rejects(
    executor.execute({
      source: "unknown-tool",
      sessionId: "safe-id",
      cwd: "/Users/demo/project",
    }),
  );
  await assert.rejects(
    executor.execute({
      source: "codex",
      sessionId: "bad;argument",
      cwd: "/Users/demo/project",
    }),
  );
  assert.equal(calls, 0);
});

test("cancels a pending launch without exposing or executing another command", async () => {
  const child = new FakeChild();
  const controller = new AbortController();
  const executor = createNodeResumeExecutor({
    spawn: (() => child) as unknown as typeof spawn,
    resolveExecutable: async (file) => file,
  });

  const pending = executor.execute(
    {
      source: "codex",
      sessionId: "safe-id_02",
      cwd: "/Users/demo/project",
    },
    controller.signal,
  );
  controller.abort();

  await assert.rejects(pending, /resume cancelled/);
  assert.equal(child.killCalled, true);
  assert.equal(child.unrefCalled, false);
});
