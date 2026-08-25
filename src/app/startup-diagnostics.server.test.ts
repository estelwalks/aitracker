import assert from "node:assert/strict";
import test from "node:test";

import { startupFailureCode } from "./startup-diagnostics.server.ts";

test("startupFailureCode exposes only recognized database codes", () => {
  const error = Object.assign(new Error("raw C:\\Users\\private"), {
    code: "already-open",
  });
  assert.equal(startupFailureCode(error), "database.already-open");
  assert.equal(
    startupFailureCode({ cause: { cause: { code: "access-denied" } } }),
    "database.access-denied",
  );
  assert.equal(
    startupFailureCode({ code: "raw:secret" }),
    "startup.unavailable",
  );
  assert.equal(
    startupFailureCode(new Error("C:\\Users\\private")),
    "startup.unavailable",
  );
});
