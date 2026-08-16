import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("market panel (under /skills) consumes opaque package refs only", () => {
  const source = readFileSync(
    new URL("./presentation/MarketPanel.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /repoPath|repo_path/);
  assert.match(source, /packageRef/);
});
