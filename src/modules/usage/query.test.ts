import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("tracker query is a server function, never a browser-side server import", () => {
  const source = readFileSync(new URL("./query.ts", import.meta.url), "utf8");

  assert.match(source, /createServerFn\(\{ method: "GET" \}\)/);
  assert.match(
    source,
    /\.handler\([\s\S]*await import\("\.\/api\.server\.ts"\)/,
  );
  assert.doesNotMatch(source, /export async function getTrackerQuery/);
});
