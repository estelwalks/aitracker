import assert from "node:assert/strict";
import test from "node:test";

import { markDynamicResponseNoStore } from "./server.ts";

test("dynamic server responses are never reused from browser cache", () => {
  for (const response of [
    new Response("<html></html>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
    Response.json({ boards: { project: { rows: [] } } }),
  ]) {
    assert.equal(
      markDynamicResponseNoStore(response).headers.get("cache-control"),
      "no-store",
    );
  }
});
