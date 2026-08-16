import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  collectCodexContextRecord,
  consumeCodexPendingContext,
  createCodexPendingContext,
} from "./codex-context.ts";

test("current custom_tool_call exec schema produces only a safe command signature", async () => {
  const fixture = await readFile(
    join(
      process.cwd(),
      "src/lib/local-sessions/__fixtures__/codex-current-envelope.jsonl",
    ),
    "utf8",
  );
  const state = createCodexPendingContext();
  for (const line of fixture.trim().split("\n")) {
    collectCodexContextRecord(
      state,
      JSON.parse(line) as Record<string, unknown>,
    );
  }
  const context = consumeCodexPendingContext(state);
  assert.deepEqual(context?.commands, [
    {
      kind: "exec_command",
      executable: "git",
      safeSignature: "git status",
      duration: "unknown",
      outputSize: "unknown",
      exitStatus: "unknown",
      calls: 1,
    },
  ]);
  assert.ok(context?.tools?.some((tool) => tool.name === "exec"));
  assert.ok(context?.tools?.some((tool) => tool.name === "apply_patch"));
  assert.equal(JSON.stringify(context).includes("--short"), false);
});
