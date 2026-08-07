import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("settings route uses the public data-lifecycle facade", () => {
  const source = readFileSync(
    new URL("../../routes/settings.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /local-usage\/prune\.server/);
  assert.match(source, /getStorageUsageQuery/);
  assert.match(source, /applyRetentionPolicyQuery/);
  assert.match(source, /clearRegenerableCacheQuery/);
});

test("settings query facade exposes no filesystem implementation symbols", () => {
  const source = readFileSync(new URL("./query.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /node:fs|node:path|homedir|readdir|rm\(/);
  assert.match(source, /await import\([\s\S]*prune\.server/);
});
