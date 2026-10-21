import assert from "node:assert/strict";
import test from "node:test";

import { createErrorRecord, formatErrorRecord } from "./error-diagnostics.ts";

test("a real Error keeps its name, message, stack and cause chain", () => {
  const cause = new Error("database is locked");
  const error = new TypeError("Failed to load route data", { cause });

  const record = createErrorRecord(error, {
    route: "/settings",
    locale: "ja-JP",
    currency: "JPY",
  });

  assert.equal(record.name, "TypeError");
  assert.equal(record.message, "Failed to load route data");
  assert.match(record.stack ?? "", /TypeError/);
  assert.deepEqual(record.causes, [cause.stack]);
  assert.equal(record.route, "/settings");
  assert.equal(record.locale, "ja-JP");
  assert.equal(record.currency, "JPY");
  assert.equal(record.fallback, false);
});

test("a thrown non-Error value is described instead of dropped", () => {
  const record = createErrorRecord("boom");

  assert.equal(record.name, "string");
  assert.equal(record.message, "boom");
  assert.equal(record.stack, undefined);
  assert.equal(record.fallback, true);
  assert.match(formatErrorRecord(record), /not an Error instance/);
});

test("a thrown plain object keeps its serialized shape", () => {
  const record = createErrorRecord({ code: "E_LOCKED", retryable: false });

  assert.equal(record.name, "object");
  assert.match(record.message, /E_LOCKED/);
  assert.equal(record.fallback, true);
});

test("the formatted report names the app, route and preferences", () => {
  const report = formatErrorRecord(
    createErrorRecord(new Error("snapshot read failed"), {
      route: "/reports",
      locale: "ko-KR",
      currency: "KRW",
    }),
  );

  assert.match(report, /^\[AITracker .*\] render error/);
  assert.match(report, /route: \/reports/);
  assert.match(report, /locale: ko-KR {3}currency: KRW/);
  assert.match(report, /Error: snapshot read failed/);
  assert.match(report, /stack:/);
});
