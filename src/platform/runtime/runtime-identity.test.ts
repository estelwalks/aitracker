import assert from "node:assert/strict";
import test from "node:test";
import { ENV } from "../../lib/app-config";

import {
  createNodeRuntimeIdentity,
  parseBooleanFlag,
  resolveRuntimeIdentity,
} from "./index.ts";

test("development web defaults to no background scanning", () => {
  const identity = createNodeRuntimeIdentity({
    env: { NODE_ENV: "development" },
    platform: "darwin",
  });

  assert.deepEqual(identity, {
    kind: "web",
    mode: "development",
    platform: "macos",
    backgroundTasksEnabled: false,
    backgroundTasksReason: "web-default-disabled",
  });
});

test("web requires an explicit true flag to enable background work", () => {
  const identity = createNodeRuntimeIdentity({
    env: {
      NODE_ENV: "development",
      [ENV.ENABLE_BACKGROUND_TASKS]: "true",
    },
    platform: "win32",
  });

  assert.equal(identity.backgroundTasksEnabled, true);
  assert.equal(identity.backgroundTasksReason, "explicitly-enabled");
});

test("desktop is enabled on supported desktop platforms and can be disabled", () => {
  const enabled = createNodeRuntimeIdentity({
    env: { [ENV.RUNTIME]: "desktop" },
    platform: "darwin",
  });
  const disabled = createNodeRuntimeIdentity({
    env: {
      [ENV.RUNTIME]: "desktop",
      [ENV.ENABLE_BACKGROUND_TASKS]: "false",
    },
    platform: "win32",
  });

  assert.equal(enabled.backgroundTasksEnabled, true);
  assert.equal(enabled.backgroundTasksReason, "desktop-default-enabled");
  assert.equal(disabled.backgroundTasksEnabled, false);
  assert.equal(disabled.backgroundTasksReason, "explicitly-disabled");
});

test("test runtime is controllable without process or a real user directory", () => {
  const disabled = resolveRuntimeIdentity({
    kind: "test",
    platform: "macos",
  });
  const enabled = resolveRuntimeIdentity({
    kind: "test",
    platform: "windows",
    enableBackgroundTasks: true,
  });

  assert.equal(disabled.backgroundTasksEnabled, false);
  assert.equal(disabled.backgroundTasksReason, "test-default-disabled");
  assert.equal(enabled.backgroundTasksEnabled, true);
  assert.equal(enabled.backgroundTasksReason, "explicitly-enabled");
});

test("linux and unknown platforms remain disabled even with an opt-in", () => {
  const linux = resolveRuntimeIdentity({
    kind: "desktop",
    platform: "linux",
    enableBackgroundTasks: true,
  });
  const unknown = resolveRuntimeIdentity({
    kind: "desktop",
    platform: "unknown",
    enableBackgroundTasks: true,
  });

  assert.equal(linux.backgroundTasksEnabled, false);
  assert.equal(linux.backgroundTasksReason, "linux-planned");
  assert.equal(unknown.backgroundTasksEnabled, false);
  assert.equal(unknown.backgroundTasksReason, "unsupported-platform");
});

test("only exact boolean flag values are accepted", () => {
  assert.equal(parseBooleanFlag("true"), true);
  assert.equal(parseBooleanFlag("false"), false);
  assert.equal(parseBooleanFlag("TRUE"), undefined);
  assert.equal(parseBooleanFlag(undefined), undefined);
});
