import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../../lib/errors.ts";
import { validateSessionsPageInput } from "./query.ts";

test("session query facade normalizes the browser-safe page contract", () => {
  const result = validateSessionsPageInput({
    filter: {
      source: "codex",
      projectId: "trusttools_webapp",
      keyword: "scanner",
      range: "30d",
      status: "available",
    },
    page: 2,
    pageSize: 25,
    sort: { field: "totalTokens", direction: "asc" },
  });

  assert.deepEqual(result, {
    filter: {
      source: "codex",
      projectId: "trusttools_webapp",
      keyword: "scanner",
      range: "30d",
      status: "available",
    },
    page: 2,
    pageSize: 25,
    sort: { field: "totalTokens", direction: "asc" },
  });
  assert.doesNotMatch(JSON.stringify(result), /command|cwd|path|transcript/i);
});

test("session query facade rejects private launch fields and invalid sources", () => {
  assert.throws(
    () =>
      validateSessionsPageInput({
        filter: { source: "codex", command: "codex resume something" },
      }),
    AppError,
  );
  assert.throws(
    () => validateSessionsPageInput({ filter: { source: "../codex" } }),
    AppError,
  );
  assert.throws(() => validateSessionsPageInput({ pageSize: 101 }), AppError);
});
