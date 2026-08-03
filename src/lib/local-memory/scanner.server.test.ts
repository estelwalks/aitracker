import assert from "node:assert/strict";
import test from "node:test";

import { markdownSummary, markdownTitle } from "./scanner.server.ts";

test("extracts markdown title and readable summary", () => {
  const content =
    "# Project Rules\n\nUse TypeScript and run tests before release.";
  assert.equal(markdownTitle(content, "/tmp/AGENTS.md"), "Project Rules");
  assert.equal(
    markdownSummary(content),
    "Project Rules Use TypeScript and run tests before release.",
  );
});

test("falls back to filename for title", () => {
  assert.equal(markdownTitle("No heading", "/tmp/CLAUDE.md"), "CLAUDE");
});
