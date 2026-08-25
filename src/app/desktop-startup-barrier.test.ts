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

test("macOS retains the strict startup barrier and collector limit", () => {
  assert.equal(
    shouldAwaitDesktopStartupTask({
      platform: "darwin",
      taskId: "usage.refresh",
      hasPersistedSnapshot: true,
    }),
    true,
  );
  assert.equal(desktopHeavyCollectorLimit("darwin"), undefined);
});

test("Windows permits two startup collectors", () => {
  assert.equal(desktopHeavyCollectorLimit("win32"), 2);
});
