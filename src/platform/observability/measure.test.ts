import assert from "node:assert/strict";
import test from "node:test";

import { createInMemoryMetrics } from "./metrics.ts";
import { findForbiddenDtoFields, measureReadModel } from "./measure.ts";

test("measureReadModel returns the original value unchanged", () => {
  const input = { totals: { tokens: 42 }, trend: [1, 2, 3] };
  const { value, measurement } = measureReadModel("dashboard", () => input);
  assert.equal(value, input);
  assert.equal(measurement.name, "dashboard");
  assert.ok(measurement.durationMs >= 0);
  assert.ok(measurement.dtoBytes > 0);
});

test("measureReadModel records bytes and duration metrics", () => {
  const metrics = createInMemoryMetrics();
  const { measurement } = measureReadModel(
    "widget",
    () => ({ revision: "r1", status: "fresh" }),
    { metrics, metricPrefix: "perf" },
  );
  assert.equal(
    measurement.dtoBytes,
    Buffer.byteLength('{"revision":"r1","status":"fresh"}'),
  );
  const snapshot = metrics.snapshot();
  assert.ok(snapshot.some((m) => m.name === "perf.widget.duration_ms"));
  assert.ok(snapshot.some((m) => m.name === "perf.widget.dto_bytes"));
});

test("measureReadModel tolerates non-serializable values", () => {
  const circular: { self?: unknown } = {};
  circular.self = circular;
  const { measurement } = measureReadModel("circular", () => circular);
  assert.equal(measurement.dtoBytes, 0);
});

test("findForbiddenDtoFields detects sensitive field names at any depth", () => {
  assert.deepEqual(findForbiddenDtoFields({ command: "x" }), ["$.command"]);
  assert.deepEqual(findForbiddenDtoFields({ nested: { prompt: "y" } }), [
    "$.nested.prompt",
  ]);
  assert.deepEqual(findForbiddenDtoFields([{ apiKey: "z" }]), ["$[0].apiKey"]);
  assert.deepEqual(findForbiddenDtoFields({ fine: 1 }), []);
  assert.deepEqual(findForbiddenDtoFields(null), []);
  assert.deepEqual(findForbiddenDtoFields("plain"), []);
});

test("findForbiddenDtoFields is case-insensitive", () => {
  assert.deepEqual(findForbiddenDtoFields({ APIKey: "x" }), ["$.APIKey"]);
  assert.deepEqual(findForbiddenDtoFields({ SessionBody: "x" }), [
    "$.SessionBody",
  ]);
});
