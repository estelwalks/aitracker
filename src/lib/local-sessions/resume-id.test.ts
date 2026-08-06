import assert from "node:assert/strict";
import { describe, test as it } from "node:test";
import { listSessionTools } from "../tool-registry/registry.ts";

describe("P4-T4 session whitelist derivation", () => {
  it("session sources derive from the registry resume capability", () => {
    assert.deepEqual([...listSessionTools()], ["claude-code", "codex", "grok"]);
  });
});
