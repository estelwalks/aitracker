import assert from "node:assert/strict";
import test from "node:test";

import {
  clearErrorRecords,
  createErrorRecord,
  formatErrorRecord,
  readErrorRecords,
  storeErrorRecord,
  type DiagnosticsStorage,
} from "./error-diagnostics.ts";

function memoryStorage(): DiagnosticsStorage & {
  readonly raw: Map<string, string>;
} {
  const raw = new Map<string, string>();
  return {
    raw,
    getItem: (key) => raw.get(key) ?? null,
    setItem: (key, value) => {
      raw.set(key, value);
    },
  };
}

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

test("storing keeps a bounded ring buffer without losing the newest record", () => {
  const storage = memoryStorage();
  for (let index = 0; index < 25; index += 1) {
    storeErrorRecord(
      createErrorRecord(new Error(`failure ${index}`), { route: "/tracker" }),
      storage,
    );
  }

  const records = readErrorRecords(storage);
  assert.equal(records.length, 20);
  assert.equal(records.at(-1)?.message, "failure 24");
  assert.equal(records[0]?.message, "failure 5");
});

test("corrupt or unavailable storage degrades to an empty history", () => {
  const storage = memoryStorage();
  storage.setItem("anything", "not json");

  assert.deepEqual(readErrorRecords(storage), []);

  const failing: DiagnosticsStorage = {
    getItem: () => {
      throw new Error("storage disabled");
    },
    setItem: () => {
      throw new Error("storage disabled");
    },
  };
  assert.deepEqual(
    storeErrorRecord(createErrorRecord(new Error("x")), failing),
    [],
  );
  assert.deepEqual(readErrorRecords(failing), []);
});

test("clearing history keeps the store readable", () => {
  const storage = memoryStorage();
  storeErrorRecord(createErrorRecord(new Error("x")), storage);
  assert.equal(readErrorRecords(storage).length, 1);

  clearErrorRecords(storage);
  assert.deepEqual(readErrorRecords(storage), []);
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
