import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("market route consumes opaque package refs only", () => {
  const source = readFileSync(
    new URL("../../routes/market.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /repoPath|repo_path/);
  assert.match(source, /packageRef/);
});
