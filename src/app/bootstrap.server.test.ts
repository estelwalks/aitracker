import assert from "node:assert/strict";
import test from "node:test";

import {
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
      : "web-default-disabled",
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
    reason: "web-default-disabled",
  });
});
