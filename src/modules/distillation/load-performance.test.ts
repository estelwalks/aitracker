import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./api.server.ts", import.meta.url),
  "utf8",
);

test("workbench loader serves the session snapshot instead of synchronously refreshing it", () => {
  assert.match(source, /await root\.sessionSnapshot\.ensureHydrated\(\)/);
  assert.doesNotMatch(
    source,
    /sessionSnapshot\s*\.requestRefresh\(\{ reason: "manual" \}\)/,
  );
});

test("Skill Management uses the compact distillation activity projection", () => {
  assert.match(source, /export async function loadDistillationActivity/);
  assert.doesNotMatch(
    source.slice(source.indexOf("loadDistillationActivity")),
    /root\.sessions\.query/,
  );
});
