import assert from "node:assert/strict";
import test from "node:test";

import { parseExternalUsageAdapterFile } from "./config.server.ts";
import { USAGE_ADAPTER_PRESETS } from "./presets.ts";

test("accepts Aipy SQLite and WorkBuddy JSONL presets", () => {
  const result = parseExternalUsageAdapterFile({
    version: 1,
    adapters: [USAGE_ADAPTER_PRESETS.aipy, USAGE_ADAPTER_PRESETS.workbuddy],
  });

  assert.equal(result.diagnostics.length, 0);
  assert.deepEqual(
    result.file?.adapters.map((adapter) => adapter.id),
    ["aipy", "workbuddy"],
  );
});

test("rejects mutating SQLite queries", () => {
  const result = parseExternalUsageAdapterFile({
    version: 1,
    adapters: [
      {
        ...USAGE_ADAPTER_PRESETS.aipy,
        query: "UPDATE task_event SET done = 1",
      },
    ],
  });

  assert.equal(result.file, undefined);
  assert.equal(result.diagnostics[0]?.code, "config-invalid");
});
