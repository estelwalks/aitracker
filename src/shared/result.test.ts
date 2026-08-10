import assert from "node:assert/strict";
import test from "node:test";

import { err, isErr, isOk, mapResult, ok } from "./result.ts";

test("shared Result preserves typed, stable errors", () => {
  const failure = err("errors.tasks.notFound", { retryable: false });

  assert.equal(isErr(failure), true);
  assert.deepEqual(failure, {
    ok: false,
    error: { code: "errors.tasks.notFound", params: { retryable: false } },
  });
});

test("shared Result maps only successful values", () => {
  const success = mapResult(ok(2), (value) => value * 3);
  const failure = mapResult(err("errors.tasks.notFound"), () => 3);

  assert.equal(isOk(success), true);
  assert.deepEqual(success, { ok: true, value: 6 });
  assert.deepEqual(failure, {
    ok: false,
    error: { code: "errors.tasks.notFound" },
  });
});
