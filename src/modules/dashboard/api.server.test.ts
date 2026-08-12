import assert from "node:assert/strict";
import test from "node:test";

import type { LocalUsageSnapshot } from "../../lib/local-usage/types.ts";
import { APP_ID } from "../../lib/app-config.ts";
import {
  aggregateDashboardProjectSessions,
  aggregateDashboardSourceSessions,
  toDashboardSnapshot,
  toDashboardV2Snapshot,
} from "./api.server.ts";

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
    sessions: {
      available: true,
      generatedAt: null,
      byProjectDay: [],
      bySourceDay: [],
    },
    pricingAvailable: true,
    outputAvailability: {
      securityRuns: { count: null, available: false },
      distillationOutputs: { count: null, available: false },
      dailyReports: { count: null, available: false },
    },
  });

  assert.deepEqual(result.events[0]?.context, {
    textResponses: 0,
    toolCalls: 0,
    tools: [],
    skillCalls: 0,
    toolOutputCalls: 0,
  });
  assert.deepEqual(result.events[0]?.evidence, {
    textResponses: true,
    toolCalls: true,
    skillCalls: true,
    toolOutputCalls: true,
    reasoningTokens: true,
    systemPromptTokens: false,
  });
  assert.equal(JSON.stringify(result).includes("opaque-session"), false);
  assert.equal(JSON.stringify(result).includes("/Users/example"), false);
  assert.equal(JSON.stringify(result).includes("exec_command"), false);
  assert.deepEqual(result.outputAvailability, {
    securityRuns: { count: null, available: false },
    distillationOutputs: { count: null, available: false },
    dailyReports: { count: null, available: false },
  });
  assert.equal(
    result.tools.filter((tool) => tool.usageSupport !== "unsupported").length,
    14,
  );
  assert.equal(
    result.tools.filter((tool) => tool.usageSupport === "unsupported").length,
    15,
  );
});

test("dashboard session aggregates join Codex projectRef and preserve workflow counts", () => {
  const sessions = [
    {
      projectKey: "fallback-name",
      projectRef: `/Users/example/work/${APP_ID}`,
      source: "codex",
      startedAt: "2026-08-10T10:00:00+08:00",
      turns: 6,
      editTurns: 2,
      subagentCalls: 3,
    },
    {
      projectKey: "fallback-name",
      projectRef: `/Users/example/work/${APP_ID}`,
      source: "codex",
      startedAt: "2026-08-10T11:00:00+08:00",
      turns: 4,
      editTurns: 1,
      subagentCalls: 2,
    },
  ];

  assert.deepEqual(aggregateDashboardProjectSessions(sessions), [
    {
      project: APP_ID,
      source: "codex",
      date: "2026-08-10",
      count: 2,
      turns: 10,
      editTurns: 3,
      subagentCalls: 5,
    },
  ]);
  assert.deepEqual(aggregateDashboardSourceSessions(sessions), [
    {
      source: "codex",
      date: "2026-08-10",
      count: 2,
      turns: 10,
      editTurns: 3,
      subagentCalls: 5,
    },
  ]);
});

test("dashboard V2 keeps installation detection when Claude has no usage events", () => {
  const result = toDashboardV2Snapshot({
    snapshot: toDashboardSnapshot({
      ...rawSnapshot,
      sources: [
        {
          source: "claude-code",
          available: false,
          detected: false,
          paths: ["/Users/example/.claude/projects"],
          filesConsidered: 0,
          filesRead: 0,
          filesReused: 0,
          filesParsed: 0,
          malformedLines: 0,
          events: 0,
        },
      ],
      events: 0,
      details: [],
      recent: [],
    }),
    skills: { available: true, count: 0, generatedAt: null },
    sessions: {
      available: true,
      generatedAt: null,
      byProjectDay: [],
      bySourceDay: [],
    },
    pricingAvailable: false,
    installedToolIds: new Set(["claude-code"]),
    outputAvailability: {
      securityRuns: { count: null, available: false },
      distillationOutputs: { count: null, available: false },
      dailyReports: { count: null, available: false },
    },
  });

  const claude = result.tools.find((tool) => tool.id === "claude-code");
  assert.deepEqual(claude, {
    id: "claude-code",
    name: "Claude Code",
    available: false,
    detected: true,
    usageSupport: "native",
  });
  assert.equal(JSON.stringify(result).includes("/Users/example"), false);
});
