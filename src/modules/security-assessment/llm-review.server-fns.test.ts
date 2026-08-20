import assert from "node:assert/strict";
import test from "node:test";

import {
  parseSecurityLlmReviewRequest,
  resolveSecurityLlmReviewRequestFromHistory,
} from "./llm-review.server-fns.ts";

const history = [
  {
    id: "history:trusted-1",
    report: {
      verdict: "block",
      rulesVersion: "rules-v1",
      contentHash: "content-hash-1",
      categories: {
        remote_execution: { count: 2, highestSeverity: "critical" },
        prompt_injection: { count: 1, highestSeverity: "medium" },
      },
    },
  },
];

test("security LLM aggregate is rebuilt from the authoritative history entry", () => {
  const request = resolveSecurityLlmReviewRequestFromHistory(
    "history:trusted-1",
    history,
  );
  assert.ok(request);
  assert.equal(request.assetRef, "content-hash-1");
  assert.equal(request.aggregate.verdict, "dangerous");
  assert.equal(request.aggregate.dimensions.rce.count, 2);
  assert.equal(request.aggregate.dimensions.prompt.count, 1);
  assert.deepEqual(request.aggregate.severityCounts, {
    high: 2,
    medium: 1,
    low: 0,
  });
});

test("unknown history ids and malformed authority records are rejected", () => {
  assert.equal(
    resolveSecurityLlmReviewRequestFromHistory(
      "history:browser-forged",
      history,
    ),
    null,
  );
  assert.equal(
    resolveSecurityLlmReviewRequestFromHistory("history:trusted-1", [
      { id: "history:trusted-1", report: { verdict: "block" } },
    ]),
    null,
  );
});

test("browser contract accepts only an opaque history id, never an aggregate", () => {
  assert.deepEqual(
    parseSecurityLlmReviewRequest({ historyEntryId: "history:trusted-1" }),
    { historyEntryId: "history:trusted-1" },
  );
  assert.throws(() =>
    parseSecurityLlmReviewRequest({
      assetRef: "forged",
      aggregate: { verdict: "clean" },
    }),
  );
});
