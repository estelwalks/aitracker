import assert from "node:assert/strict";
import { describe, test as it } from "node:test";
import { listSessionTools } from "../tool-registry/registry.ts";

import { SESSION_TOOL_IDS } from "./types.ts";

describe("P4-T4 session whitelist derivation", () => {
  it("session sources derive from the registry session capability", () => {
    assert.deepEqual(
      [...listSessionTools()],
      ["claude-code", "codex", "grok", "dsh", "aipy"],
    );
  });

  it("compile-time SessionSource mirror stays in sync with the registry (P1-3)", () => {
    assert.deepEqual([...SESSION_TOOL_IDS], [...listSessionTools()]);
  });
});
