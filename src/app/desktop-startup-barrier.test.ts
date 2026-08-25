import assert from "node:assert/strict";
import test from "node:test";

import {
  desktopHeavyCollectorLimit,
  shouldAwaitDesktopStartupTask,
} from "./desktop-startup-barrier.ts";

test("Windows waits when a required startup snapshot is empty", () => {
  assert.equal(
    shouldAwaitDesktopStartupTask({
      platform: "win32",
      taskId: "usage.refresh",
      hasPersistedSnapshot: false,
    }),
    true,
  );
});

test("Windows reuses an initialized snapshot while refreshing it", () => {
  assert.equal(
    shouldAwaitDesktopStartupTask({
      platform: "win32",
      taskId: "usage.refresh",
      hasPersistedSnapshot: true,
    }),
    false,
  );
  assert.equal(
    shouldAwaitDesktopStartupTask({
      platform: "win32",
      taskId: "exchange.refresh",
      hasPersistedSnapshot: false,
    }),
    false,
  );
});

test("macOS waits when a required startup snapshot is empty", () => {
  assert.equal(
    shouldAwaitDesktopStartupTask({
      platform: "darwin",
      taskId: "sessions.refresh",
      hasPersistedSnapshot: false,
    }),
    true,
  );
});

test("macOS reuses initialized snapshots while refreshing in the background", () => {
  assert.equal(
    shouldAwaitDesktopStartupTask({
      platform: "darwin",
      taskId: "usage.refresh",
      hasPersistedSnapshot: true,
    }),
    false,
  );
  assert.equal(
    shouldAwaitDesktopStartupTask({
      platform: "darwin",
      taskId: "exchange.refresh",
      hasPersistedSnapshot: false,
    }),
    false,
  );
  assert.equal(desktopHeavyCollectorLimit("darwin"), undefined);
});

test("unsupported platforms retain the strict startup barrier", () => {
  assert.equal(
    shouldAwaitDesktopStartupTask({
      platform: "linux",
      taskId: "usage.refresh",
      hasPersistedSnapshot: true,
    }),
    true,
  );
});

test("Windows permits two startup collectors", () => {
  assert.equal(desktopHeavyCollectorLimit("win32"), 2);
});
