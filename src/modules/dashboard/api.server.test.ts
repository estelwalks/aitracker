import assert from "node:assert/strict";
import test from "node:test";

import type { LocalUsageSnapshot } from "../../lib/local-usage/types.ts";
import { APP_ID } from "../../lib/app-config.ts";
import type { DashboardProjectClassification } from "./project-classification.server.ts";
import {
  aggregateDashboardProjectSessions,
  aggregateDashboardSourceSessions,
  shouldRefreshDashboardSessions,
  toDashboardSnapshot,
  toDashboardV2Snapshot,
} from "./api.server.ts";
import { createDashboardV2View } from "./application/v2.ts";

test("dashboard refreshes a fresh legacy session snapshot when usage has DSH", () => {
  assert.equal(
    shouldRefreshDashboardSessions({
      status: "fresh",
      generatedAt: "2026-08-10T00:00:00.000Z",
      sessionSources: ["codex"],
      usageSources: ["codex", "dsh"],
      nowMs: Date.parse("2026-08-10T00:01:00.000Z"),
    }),
    true,
  );
  assert.equal(
    shouldRefreshDashboardSessions({
      status: "fresh",
      generatedAt: "2026-08-10T00:00:45.000Z",
      sessionSources: ["codex"],
      usageSources: ["codex", "dsh"],
      nowMs: Date.parse("2026-08-10T00:01:00.000Z"),
    }),
    false,
  );
});

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

test("dashboard keeps project rows whose classification is still pending", () => {
  const firstProject = `/Users/example/work/${APP_ID}`;
  const secondProject = "/Users/example/work/another-project";
  const result = toDashboardSnapshot(
    {
      ...rawSnapshot,
      details: [
        { ...rawSnapshot.details[0]!, project: firstProject },
        { ...rawSnapshot.details[0]!, project: secondProject },
      ],
    },
    new Map([
      [firstProject, { kind: "workspace", label: APP_ID }],
      // The second reference is not in the persisted index yet. The query
      // path must keep it visible with the safe final-segment fallback.
    ]),
  );

  assert.deepEqual(
    result.details.map((event) => ({
      project: event.project,
      projectKind: event.projectKind,
    })),
    [
      { project: APP_ID, projectKind: "workspace" },
      { project: "another-project", projectKind: "workspace" },
    ],
  );
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
      distillationBreakdown: { capability: null, memory: null },
      dailyReports: { count: null, available: false },
      weeklyReports: { count: null, available: false },
      monthlyReports: { count: null, available: false },
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
    distillationBreakdown: { capability: null, memory: null },
    dailyReports: { count: null, available: false },
    weeklyReports: { count: null, available: false },
    monthlyReports: { count: null, available: false },
  });
  assert.equal(
    result.tools.filter((tool) => tool.usageSupport !== "unsupported").length,
    15,
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

test("dashboard project session aggregates classify by projectRef and drop non-workspace sessions", () => {
  const sessions = [
    {
      projectKey: "app",
      projectRef: `/Users/example/work/${APP_ID}`,
      source: "codex",
      startedAt: "2026-08-10T10:00:00+08:00",
      turns: 6,
      editTurns: 2,
      subagentCalls: 3,
    },
    {
      projectKey: "chat",
      projectRef: "/Users/example/chat-123",
      source: "codex",
      startedAt: "2026-08-10T11:00:00+08:00",
      turns: 4,
      editTurns: 1,
      subagentCalls: 2,
    },
    {
      // A ref missing from the classification index resolves to "unknown"
      // (never a workspace); its session must not leak into the project view.
      projectKey: "unknown-dir",
      projectRef: "/Users/example/unknown-dir",
      source: "codex",
      startedAt: "2026-08-10T12:00:00+08:00",
      turns: 1,
      editTurns: 0,
      subagentCalls: 0,
    },
  ];
  const classifications = new Map<string, DashboardProjectClassification>([
    [`/Users/example/work/${APP_ID}`, { kind: "workspace", label: APP_ID }],
    [
      "/Users/example/chat-123",
      { kind: "quick-conversation", label: "quick-conversation" },
    ],
    ["/Users/example/unknown-dir", { kind: "unknown", label: "unknown" }],
  ]);

  assert.deepEqual(
    aggregateDashboardProjectSessions(sessions, classifications),
    [
      {
        project: APP_ID,
        source: "codex",
        date: "2026-08-10",
        count: 1,
        turns: 6,
        editTurns: 2,
        subagentCalls: 3,
      },
    ],
  );
});

test("normalized session projectRef joins usage events under one project key", () => {
  // scanLocalSessions normalizes projectRef with normalizeProjectPath, so a
  // HOME-relative cwd becomes ~/… exactly like the usage scanner's
  // event.project. The classification index is keyed by that normalized form,
  // so byProjectDay must join it to the same label as usage events.
  const normalizedRef = `~/example/work/${APP_ID}`;
  const classifications = new Map<string, DashboardProjectClassification>([
    [normalizedRef, { kind: "workspace", label: APP_ID }],
  ]);

  assert.deepEqual(
    aggregateDashboardProjectSessions(
      [
        {
          projectKey: APP_ID,
          projectRef: normalizedRef,
          source: "codex",
          startedAt: "2026-08-10T10:00:00+08:00",
          turns: 6,
          editTurns: 2,
          subagentCalls: 3,
        },
      ],
      classifications,
    ),
    [
      {
        project: APP_ID,
        source: "codex",
        date: "2026-08-10",
        count: 1,
        turns: 6,
        editTurns: 2,
        subagentCalls: 3,
      },
    ],
  );

  // The same normalized ref through the usage-event path collapses to the
  // same label, so the project overview's session column can look it up.
  const usage = toDashboardSnapshot(
    {
      ...rawSnapshot,
      details: [{ ...rawSnapshot.details[0]!, project: normalizedRef }],
    },
    classifications,
  );
  assert.equal(usage.details[0]?.project, APP_ID);
});

test("DeepSeek Harness sessions map to the dashboard project row", () => {
  const projectRef = `~/example/work/${APP_ID}`;
  const classifications = new Map<string, DashboardProjectClassification>([
    [projectRef, { kind: "workspace", label: APP_ID }],
  ]);
  const usage = toDashboardSnapshot(
    {
      ...rawSnapshot,
      sources: [{ ...rawSnapshot.sources[0]!, source: "dsh" }],
      details: [
        { ...rawSnapshot.details[0]!, source: "dsh", project: projectRef },
      ],
    },
    classifications,
  );
  const v2 = toDashboardV2Snapshot({
    snapshot: usage,
    skills: { available: true, count: 0, generatedAt: null },
    sessions: {
      available: true,
      generatedAt: "2026-08-10T00:00:00.000Z",
      byProjectDay: aggregateDashboardProjectSessions(
        [
          {
            projectKey: APP_ID,
            source: "dsh",
            startedAt: "2026-08-10T10:00:00.000Z",
            turns: 1,
            editTurns: 0,
            subagentCalls: 0,
          },
        ],
        classifications,
      ),
      bySourceDay: aggregateDashboardSourceSessions([
        {
          source: "dsh",
          startedAt: "2026-08-10T10:00:00.000Z",
          turns: 1,
          editTurns: 0,
          subagentCalls: 0,
        },
      ]),
    },
    pricingAvailable: false,
    outputAvailability: {
      securityRuns: { count: null, available: false },
      distillationOutputs: { count: null, available: false },
      distillationBreakdown: { capability: null, memory: null },
      dailyReports: { count: null, available: false },
      weeklyReports: { count: null, available: false },
      monthlyReports: { count: null, available: false },
    },
  });
  const view = createDashboardV2View(v2, "custom", "2026-08-10", "2026-08-10");

  assert.equal(view.tools.find((tool) => tool.id === "dsh")?.events, 1);
  assert.equal(view.projects[0]?.key, APP_ID);
  assert.equal(view.projects[0]?.sessions, 1);
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
      distillationBreakdown: { capability: null, memory: null },
      dailyReports: { count: null, available: false },
      weeklyReports: { count: null, available: false },
      monthlyReports: { count: null, available: false },
    },
  });

  const claude = result.tools.find((tool) => tool.id === "claude-code");
  assert.deepEqual(claude, {
    id: "claude-code",
    name: "Claude Code",
    icon: "claude",
    color: "#d97757",
    available: false,
    detected: true,
    usageSupport: "native",
  });
  assert.equal(JSON.stringify(result).includes("/Users/example"), false);
});
