import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("skills route consumes opaque installation refs only", () => {
  const source = readFileSync(
    new URL("../../routes/skills.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /installation\.path|sourcePath\s*:|detectedPaths/,
  );
  assert.match(source, /installationRef/);
});
