import assert from "node:assert/strict";
import test from "node:test";

import { electronMessages } from "./i18n.js";
import {
  createStartupWarmupError,
  normalizeStartupFailureCode,
  startupFailureDialogMessage,
} from "./startup-failure.js";

test("startup failure details use only known, path-free codes", () => {
  assert.equal(
    normalizeStartupFailureCode("database.already-open"),
    "database.already-open",
  );
  assert.equal(
    normalizeStartupFailureCode("C:\\Users\\private"),
    "startup.unavailable",
  );

  const message = startupFailureDialogMessage(
    electronMessages["zh-CN"].dialog.startupFailure,
    createStartupWarmupError(500, "database.already-open"),
  );
  assert.match(message, /本地数据正被另一个 AITracker 实例/u);
  assert.match(message, /database\.already-open/u);
  assert.doesNotMatch(message, /C:\\Users/u);
});
