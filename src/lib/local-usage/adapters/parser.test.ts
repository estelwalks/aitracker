import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import type { LocalUsageEvent, LocalUsageSource } from "../types.ts";
import { GENERIC_BUILTIN_USAGE_ADAPTERS } from "./catalog.ts";
import { eventFromMappedRecord, recordsFromJson } from "./parser.ts";

const FIXTURE_DIRECTORY = join(import.meta.dirname, "__fixtures__");
const CASES: Array<{
  source: LocalUsageSource;
  file: string;
  format: "json" | "jsonl";
}> = [
  { source: "cursor", file: "cursor.json", format: "json" },
  { source: "gemini-cli", file: "gemini-cli.json", format: "json" },
  { source: "kimi-code", file: "kimi-code.jsonl", format: "jsonl" },
  { source: "opencode", file: "opencode.json", format: "json" },
  { source: "grok", file: "grok.jsonl", format: "jsonl" },
  { source: "github-copilot", file: "github-copilot.jsonl", format: "jsonl" },
  { source: "cline", file: "cline.json", format: "json" },
  { source: "roo-code", file: "roo-code.json", format: "json" },
];

for (const fixture of CASES) {
  test(`${fixture.source} fixture matches its golden usage event`, async () => {
    const adapter = GENERIC_BUILTIN_USAGE_ADAPTERS.find(
      (candidate) => candidate.source === fixture.source,
    );
    assert.ok(adapter);
    const content = await readFile(
      join(FIXTURE_DIRECTORY, fixture.file),
      "utf8",
    );
    const values =
      fixture.format === "jsonl"
        ? content
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line) as unknown)
        : [JSON.parse(content) as unknown];
    const events: LocalUsageEvent[] = [];
    for (const value of values) {
      const records =
        fixture.format === "json"
          ? recordsFromJson(value, adapter.mapping).records
          : [value as Record<string, unknown>];
      for (const record of records) {
        const event = eventFromMappedRecord(record, adapter);
        if (event != null) events.push(event);
      }
    }
    const golden = JSON.parse(
      await readFile(
        join(FIXTURE_DIRECTORY, "golden", `${fixture.source}.json`),
        "utf8",
      ),
    ) as LocalUsageEvent;
    assert.deepEqual(events, [golden]);
  });
}

test("mapped structured session id is opaque and preferred over file fallback", () => {
  const adapter = GENERIC_BUILTIN_USAGE_ADAPTERS.find(
    (candidate) => candidate.source === "kimi-code",
  );
  assert.ok(adapter);
  const event = eventFromMappedRecord(
    {
      timestamp: "2026-07-27T09:00:00.000Z",
      session_id: "private-structured-session",
      prompt: "private prompt body",
      usage: { input_tokens: 4, output_tokens: 2 },
    },
    adapter,
    "session_00000000000000000000",
  );

  assert.ok(event);
  assert.match(event.sessionId ?? "", /^session_[a-f0-9]{20}$/);
  assert.notEqual(event.sessionId, "session_00000000000000000000");
  assert.doesNotMatch(
    JSON.stringify(event),
    /private-structured-session|private prompt body/,
  );
});
