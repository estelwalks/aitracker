import assert from "node:assert/strict";
import test from "node:test";

import {
  BackgroundRuntimeBootstrapError,
  createBackgroundRuntimeBootstrap,
  type BackgroundRuntime,
} from "./bootstrap.server.ts";
import type { RuntimeIdentity } from "../platform/runtime";

function identity(enabled: boolean): RuntimeIdentity {
  return {
    kind: "web",
    mode: "development",
    platform: "macos",
    backgroundTasksEnabled: enabled,
    backgroundTasksReason: enabled
      ? "explicitly-enabled"
      : "explicitly-disabled",
  };
}

test("background bootstrap starts an enabled runtime only once under concurrent calls", async () => {
  let starts = 0;
  const runtime: BackgroundRuntime = {
    start: async () => {
      starts += 1;
    },
  };
  const bootstrap = createBackgroundRuntimeBootstrap({
    getRuntimeIdentity: () => identity(true),
    createBackgroundRuntime: () => runtime,
  });

  const results = await Promise.all([
    bootstrap.ensureStarted(),
    bootstrap.ensureStarted(),
  ]);

  assert.equal(starts, 1);
  assert.deepEqual(results, [
    { status: "started", reason: "explicitly-enabled" },
    { status: "started", reason: "explicitly-enabled" },
  ]);
});

test("background bootstrap does not construct a runtime when policy disables it", async () => {
  let constructed = 0;
  const bootstrap = createBackgroundRuntimeBootstrap({
    getRuntimeIdentity: () => identity(false),
    createBackgroundRuntime: () => {
      constructed += 1;
      return { start: () => undefined };
    },
  });

  const result = await bootstrap.ensureStarted();

  assert.equal(constructed, 0);
  assert.deepEqual(result, {
    status: "disabled",
    reason: "explicitly-disabled",
  });
});

test("failed start is mapped to a stable error and can be retried", async () => {
  let attempts = 0;
  const bootstrap = createBackgroundRuntimeBootstrap({
    getRuntimeIdentity: () => identity(true),
    createBackgroundRuntime: () => ({
      start: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("secret path /Users/me/token");
      },
    }),
  });

  await assert.rejects(bootstrap.ensureStarted(), (error: unknown) => {
    assert.ok(error instanceof BackgroundRuntimeBootstrapError);
    assert.equal(error.code, "errors.runtime.bootstrap-failed");
    assert.equal(error.message.includes("/Users/me"), false);
    return true;
  });
  assert.deepEqual(await bootstrap.ensureStarted(), {
    status: "started",
    reason: "explicitly-enabled",
  });
  assert.equal(attempts, 2);
});

test("factory failures are also mapped and do not poison a retry", async () => {
  let attempts = 0;
  const bootstrap = createBackgroundRuntimeBootstrap({
    getRuntimeIdentity: () => identity(true),
    createBackgroundRuntime: () => {
      attempts += 1;
      if (attempts === 1) throw new Error("secret credential");
      return { start: () => undefined };
    },
  });

  await assert.rejects(
    bootstrap.ensureStarted(),
    BackgroundRuntimeBootstrapError,
  );
  assert.equal((await bootstrap.ensureStarted()).status, "started");
  assert.equal(attempts, 2);
});

test("stop is explicit, idempotent, and waits for a successful start", async () => {
  let starts = 0;
  let stops = 0;
  const bootstrap = createBackgroundRuntimeBootstrap({
    getRuntimeIdentity: () => identity(true),
    createBackgroundRuntime: () => ({
      start: async () => {
        starts += 1;
        await Promise.resolve();
      },
      stop: async () => {
        stops += 1;
      },
    }),
  });

  const starting = bootstrap.ensureStarted();
  await Promise.all([starting, bootstrap.stop(), bootstrap.stop()]);
  assert.equal(starts, 1);
  assert.equal(stops, 1);

  await bootstrap.stop();
  assert.equal(stops, 1);
});

test("disabled bootstrap stop is a no-op", async () => {
  let stops = 0;
  const bootstrap = createBackgroundRuntimeBootstrap({
    getRuntimeIdentity: () => identity(false),
    createBackgroundRuntime: () => ({
      start: () => undefined,
      stop: () => {
        stops += 1;
      },
    }),
  });

  await bootstrap.ensureStarted();
  await bootstrap.stop();
  assert.equal(stops, 0);
});
