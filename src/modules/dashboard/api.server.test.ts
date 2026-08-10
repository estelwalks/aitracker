import assert from "node:assert/strict";
import test from "node:test";

import type { LocalUsageSnapshot } from "../../lib/local-usage/types.ts";
import { APP_ID } from "../../lib/app-config.ts";
import { toDashboardSnapshot, toDashboardV2Snapshot } from "./api.server.ts";

const rawSnapshot: LocalUsageSnapshot = {
  generatedAt: "2026-08-10T00:00:00.000Z",
  mode: "real",
  sources: [
    {
      source: "codex",
      available: true,
      paths: ["/Users/example/.codex/sessions"],
      filesConsidered: 1,
      filesRead: 1,
      filesReused: 0,
      filesParsed: 1,
      malformedLines: 0,
      events: 1,
      diagnostics: [
        {
          code: "read-failed",
          source: "codex",
          path: "/Users/example/secret.jsonl",
          count: 1,
          message: "read failed",
        },
      ],
    },
  ],
  events: 1,
  totals: {
    events: 1,
    inputTokens: 10,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    outputTokens: 5,
    reasoningOutputTokens: 0,
    totalTokens: 15,
  },
  bySource: [],
  byModel: [],
  byProject: [],
  daily: [],
  details: [
    {
      source: "codex",
      timestamp: "2026-08-10T00:00:00.000Z",
      model: "gpt-test",
      project: `/Users/example/work/${APP_ID}`,
      sessionId: "opaque-session",
      inputTokens: 10,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      outputTokens: 5,
      reasoningOutputTokens: 0,
      totalTokens: 15,
      context: {
        commands: [
          {
            kind: "exec_command",
            executable: "cat",
            safeSignature: "cat /private/file",
            duration: "under-1s",
            outputSize: "empty",
            exitStatus: "success",
            calls: 1,
          },
        ],
      },
    },
  ],
  recent: [],
};

test("dashboard snapshot projects scanner data without paths or command summaries", () => {
  const result = toDashboardSnapshot(rawSnapshot);

  assert.deepEqual(result.sources[0], {
    source: "codex",
    available: true,
    filesConsidered: 1,
    filesRead: 1,
    filesReused: 0,
    filesParsed: 1,
    malformedLines: 0,
    events: 1,
  });
  assert.equal(result.details[0]?.project, APP_ID);
  assert.equal("commands" in (result.details[0]?.context ?? {}), false);
  assert.equal(JSON.stringify(result).includes("/Users/example"), false);
  assert.equal(JSON.stringify(result).includes("opaque-session"), false);
});

test("dashboard V2 projection contains only aggregate-safe context and no session id", () => {
  const snapshot = toDashboardSnapshot(rawSnapshot);
  const result = toDashboardV2Snapshot({
    snapshot,
    skills: { available: true, count: 3, generatedAt: "2026-08-10T00:00:00Z" },
    sessions: { available: true, generatedAt: null, records: [] },
    pricingAvailable: true,
  });

  assert.deepEqual(result.events[0]?.context, {
    textResponses: 0,
    toolCalls: 0,
    skillCalls: 0,
    toolOutputCalls: 0,
  });
  assert.equal(JSON.stringify(result).includes("opaque-session"), false);
  assert.equal(JSON.stringify(result).includes("/Users/example"), false);
  assert.equal(JSON.stringify(result).includes("exec_command"), false);
});
