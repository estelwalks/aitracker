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
  });

  await executor.execute({ source: "codex", sessionId: "safe-id_01" });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.slice(0, 2), ["codex", ["resume", "safe-id_01"]]);
  assert.deepEqual(calls[0]?.[2], {
    detached: true,
    shell: false,
    stdio: "ignore",
    windowsHide: true,
  });
  assert.equal(child.unrefCalled, true);
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
    executor.execute({ source: "unknown-tool", sessionId: "safe-id" }),
  );
  await assert.rejects(
    executor.execute({ source: "codex", sessionId: "bad;argument" }),
  );
  assert.equal(calls, 0);
});

test("cancels a pending launch without exposing or executing another command", async () => {
  const child = new FakeChild();
  const controller = new AbortController();
  const executor = createNodeResumeExecutor({
    spawn: (() => child) as unknown as typeof spawn,
  });

  const pending = executor.execute(
    { source: "codex", sessionId: "safe-id_02" },
    controller.signal,
  );
  controller.abort();

  await assert.rejects(pending, /resume cancelled/);
  assert.equal(child.killCalled, true);
  assert.equal(child.unrefCalled, false);
});
