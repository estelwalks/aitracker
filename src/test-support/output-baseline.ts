/**
 * P0-01 contract fixtures. These values are synthetic and intentionally omit
 * machine paths, executable commands, credentials, and conversation content.
 */
import type { MarketListResult } from "../lib/local-market/types.ts";
import type { SessionSummary } from "../lib/local-sessions/types.ts";
import { SKILL_AGENTS, type SkillSnapshot } from "../lib/local-skills/types.ts";
import type { LocalUsageSnapshot } from "../lib/local-usage/types.ts";
import type { SecurityReport } from "../lib/security/scanner.ts";

export const VOLATILE_BASELINE_FIELDS = [
  "generatedAt",
  "fetchedAt",
  "scannedAt",
  "runId",
] as const;

const VOLATILE_FIELDS = new Set<string>(VOLATILE_BASELINE_FIELDS);
export const BASELINE_VOLATILE_VALUE = "<volatile>";

/** Replaces only explicitly-listed non-business values, recursively. */
export function normalizeBaselineOutput(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeBaselineOutput);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        VOLATILE_FIELDS.has(key)
          ? BASELINE_VOLATILE_VALUE
          : normalizeBaselineOutput(child),
      ]),
    );
  }
  return value;
}

const counts = {
  inputTokens: 120,
  cachedInputTokens: 20,
  cacheCreationInputTokens: 0,
  outputTokens: 30,
  reasoningOutputTokens: 10,
  totalTokens: 180,
};

export const usageSnapshotFixture: LocalUsageSnapshot = {
  generatedAt: "2026-08-06T00:00:00.000Z",
  mode: "real",
  sources: [
    {
      source: "codex",
      available: true,
      filesConsidered: 1,
      filesRead: 1,
      filesReused: 0,
      filesParsed: 1,
      malformedLines: 0,
      events: 1,
    },
  ],
  events: 1,
  totals: { events: 1, ...counts },
  bySource: [{ key: "codex", events: 1, ...counts }],
  byModel: [{ key: "synthetic-model", events: 1, ...counts }],
  byProject: [{ key: "sample-project", events: 1, ...counts }],
  daily: [
    { date: "2026-08-06", events: 1, ...counts, bySource: { codex: counts } },
  ],
  details: [
    {
      source: "codex",
      timestamp: "2026-08-06T00:00:00.000Z",
      model: "synthetic-model",
      project: "sample-project",
      sessionId: "sample-session-001",
      ...counts,
    },
  ],
  recent: [
    {
      source: "codex",
      timestamp: "2026-08-06T00:00:00.000Z",
      model: "synthetic-model",
      project: "sample-project",
      sessionId: "sample-session-001",
      ...counts,
    },
  ],
};

const primaryAgent = SKILL_AGENTS[0]!;
export const skillSnapshotFixture: SkillSnapshot = {
  generatedAt: "2026-08-06T00:00:00.000Z",
  fingerprint: "fixture-v1",
  roots: Object.fromEntries(
    SKILL_AGENTS.map((agent) => [agent, ["fixtures/skills"]]),
  ),
  agents: Object.fromEntries(
    SKILL_AGENTS.map((agent) => [
      agent,
      { installed: agent === primaryAgent, detectedPaths: ["fixtures/skills"] },
    ]),
  ),
  skills: [
    {
      id: "sample-skill",
      name: "Sample Skill",
      description: "Synthetic fixture",
      form: "package",
      lastUsedAt: null,
      sizeBytes: 0,
      tokenEstimate: 0,
      installations: [],
    },
  ],
  blacklist: [],
};

export const sessionSummaryFixture: SessionSummary = {
  generatedAt: "2026-08-06T00:00:00.000Z",
  total: 1,
  sessions: [
    {
      sessionId: "sample-session-001",
      source: "codex",
      title: "Synthetic session",
      projectKey: "sample-project",
      projectRef: "~/sample-project",
      model: "synthetic-model",
      startedAt: "2026-08-06T00:00:00.000Z",
      endedAt: "2026-08-06T00:05:00.000Z",
      durationMs: 300000,
      turns: 2,
      editTurns: 0,
      retryTurns: 0,
      totals: counts,
      cost: {
        knownUsd: 0,
        estimatedUsd: 0,
        cacheSavingsUsd: 0,
        pricedEvents: 0,
        estimatedEvents: 0,
        unknownEvents: 1,
        unknownModels: ["synthetic-model"],
        complete: false,
      },
      subagentCalls: 0,
      status: "available",
      statusReason: null,
      resumeSafe: false,
      resumeCommand: null,
    },
  ],
};

export const securityReportFixture: SecurityReport = {
  scannedAt: "2026-08-06T00:00:00.000Z",
  targetName: "sample-skill",
  filesScanned: 1,
  risks: [],
  verdict: "安全",
  riskScore: 0,
  durationMs: 1,
  rulesVersion: "fixture-v1",
};

export const marketListFixture: MarketListResult = {
  skills: [
    {
      id: 1,
      name: "Sample Skill",
      slug: "sample-skill",
      description: "Synthetic fixture",
      shortDescription: "合成测试数据",
      repoOwner: "sample-owner",
      repoName: "sample-repo",
      repoPath: "skills/sample/SKILL.md",
      securityScore: 100,
      securityLevel: "low",
      stars: 1,
      tags: ["sample"],
      updatedAt: "2026-08-01T00:00:00.000Z",
      size: null,
      version: null,
      rating: null,
    },
  ],
  pagination: { page: 1, limit: 20, total: 1, pages: 1 },
  source: "cache",
  fetchedAt: "2026-08-06T00:00:00.000Z",
  warning: null,
};
