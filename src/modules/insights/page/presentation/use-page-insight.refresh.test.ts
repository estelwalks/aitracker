import assert from "node:assert/strict";
import test from "node:test";

import {
  PAGE_INSIGHT_REFRESH_INTERVAL_MS,
  startPageInsightRefreshTimer,
  type PageInsightRefreshTimer,
} from "./use-page-insight.ts";

test("mounted page refreshes on the configured default period and clears the timer on cleanup", async () => {
  let callback: (() => void) | undefined;
  let delayMs: number | undefined;
  let clearedHandle: number | undefined;
  let refreshes = 0;
  const timer: PageInsightRefreshTimer = {
    setInterval(next, delay) {
      callback = next;
      delayMs = delay;
      return 17;
    },
    clearInterval(handle) {
      clearedHandle = handle;
    },
  };

  const stop = startPageInsightRefreshTimer(async () => {
    refreshes += 1;
  }, timer);

  assert.equal(delayMs, PAGE_INSIGHT_REFRESH_INTERVAL_MS);
  assert.equal(delayMs, 5 * 60 * 60 * 1000);
  assert.ok(callback);
  callback();
  await Promise.resolve();
  assert.equal(refreshes, 1);

  stop();
  assert.equal(clearedHandle, 17);
});

test("refresh timer accepts the saved insight period", () => {
  let delayMs: number | undefined;
  const timer: PageInsightRefreshTimer = {
    setInterval(_next, delay) {
      delayMs = delay;
      return 18;
    },
    clearInterval() {},
  };

  const stop = startPageInsightRefreshTimer(
    () => {},
    timer,
    12 * 60 * 60 * 1000,
  );

  assert.equal(delayMs, 12 * 60 * 60 * 1000);
  stop();
});
