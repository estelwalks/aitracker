import assert from "node:assert/strict";
import test from "node:test";

import {
  REPORT_BODY_MAX,
  safeReportText,
  wasReportTextTruncated,
} from "./domain.ts";

test("P1-10: safeReportText keeps the durable 60,000-character storage boundary", () => {
  const body = "x".repeat(70_000);
  assert.equal(safeReportText(body).length, REPORT_BODY_MAX);
  assert.equal(REPORT_BODY_MAX, 60_000);
});

test("P1-10: wasReportTextTruncated reports the explicit truncation signal", () => {
  assert.equal(wasReportTextTruncated("x".repeat(70_000)), true);
  assert.equal(wasReportTextTruncated("x".repeat(REPORT_BODY_MAX)), false);
  assert.equal(wasReportTextTruncated("short body"), false);
  // Whitespace around the body is trimmed before the length counts, matching
  // `safeReportText`'s trim-then-slice behaviour.
  assert.equal(
    wasReportTextTruncated(`  ${"x".repeat(REPORT_BODY_MAX)}  `),
    false,
  );
  assert.equal(
    wasReportTextTruncated(`  ${"x".repeat(REPORT_BODY_MAX + 1)}  `),
    true,
  );
  // Custom boundary for callers that truncate elsewhere.
  assert.equal(wasReportTextTruncated("123456", 5), true);
  assert.equal(wasReportTextTruncated("12345", 5), false);
});

test("safeReportText still rejects empty and sensitive bodies", () => {
  assert.throws(() => safeReportText("   "));
  assert.throws(() => safeReportText("/Users/alice/report"));
  assert.throws(() =>
    safeReportText("api_key: sk-abcdefghijklmnopqrstuvwxyz123456"),
  );
});

test("R5 privacy: safeReportText rejects command paths, credentials and secrets", () => {
  // Command paths (POSIX home / Windows drive / UNC / relative traversal).
  assert.throws(() => safeReportText("/home/alice/.ssh/id_rsa"));
  assert.throws(() => safeReportText("C:\\Users\\alice\\report"));
  assert.throws(() => safeReportText("\\\\server\\share\\report"));
  assert.throws(() => safeReportText("rm -rf ~/projects/aitracker"));
  // Credentials and secrets (bearer / api key / password / secret).
  assert.throws(() => safeReportText("Authorization: bearer abc123"));
  assert.throws(() => safeReportText("password=hunter2"));
  assert.throws(() => safeReportText("secret_token=xyz"));
  // Ordinary report prose is still accepted after trimming.
  assert.equal(
    safeReportText("  本周使用平稳，无异常。  "),
    "本周使用平稳，无异常。",
  );
});
