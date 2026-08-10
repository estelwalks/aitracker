import assert from "node:assert/strict";
import test from "node:test";

import {
  createCorrelationId,
  createRunId,
  createTaskId,
  isCorrelationId,
  isRunId,
  isTaskId,
} from "./ids.ts";

test("shared IDs create validated branded identifiers", () => {
  assert.equal(createTaskId("usage.refresh"), "usage.refresh");
  assert.equal(createRunId("run:20260806-01"), "run:20260806-01");
  assert.equal(createCorrelationId("corr-01"), "corr-01");
  assert.equal(isTaskId("usage.refresh"), true);
  assert.equal(isRunId("run:20260806-01"), true);
  assert.equal(isCorrelationId("corr-01"), true);
});

test("shared IDs reject unsafe or malformed values", () => {
  assert.equal(isTaskId("Usage Refresh"), false);
  assert.equal(isRunId("run id"), false);
  assert.equal(isCorrelationId("../../private"), false);
  assert.throws(() => createTaskId("Usage Refresh"), TypeError);
  assert.throws(() => createRunId("run id"), TypeError);
  assert.throws(() => createCorrelationId("../../private"), TypeError);
});
