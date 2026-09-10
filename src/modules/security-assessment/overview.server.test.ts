import assert from "node:assert/strict";
import test from "node:test";

import type {
  SecurityScanHistoryEntry,
  SecuritySkillTarget,
} from "../../../electron/contracts";
import type { SecurityEnginePort } from "./overview.server";
import {
  projectSecurityOverview,
  resolveSecurityOverview,
} from "./overview.server";

const ref = (seed: string): `skill:${string}` =>
  `skill:${seed.repeat(64 / seed.length + 1).slice(0, 64)}`;

const HEX64 = (seed: string): string =>
  seed.repeat(64 / seed.length + 1).slice(0, 64);

function skill(name: string, seed: string): SecuritySkillTarget {
  return {
    skillRef: ref(seed),
    name,
    agents: ["Claude Code"],
    modifiedAt: "2026-09-01T00:00:00.000Z",
    source: "discovered",
  };
}

function entry(input: {
  scanId: string;
  seed: string;
  skillName: string;
  status?: SecurityScanHistoryEntry["status"];
  verdict?: "allow" | "warn" | "block";
  findings?: number;
  startedAt: string;
  finishedAt: string;
}): SecurityScanHistoryEntry {
  const { verdict = "allow", findings = 0, status = "complete" } = input;
  return {
    id: `${input.scanId}:${input.seed.slice(0, 16)}`,
    scanId: `scan:${input.scanId}`,
    skillRef: ref(input.seed),
    skillName: input.skillName,
    mode: "quick",
    trigger: "automatic",
    locale: "zh-CN",
    status,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    ...(status === "complete"
      ? {
          report: {
            status: "complete" as const,
            mode: "quick" as const,
            verdict,
            riskScore: verdict === "block" ? 90 : verdict === "warn" ? 40 : 5,
            rulesVersion: "rules-test",
            engineVersion: "engine-test",
            locale: "zh-CN" as const,
            contentHash: HEX64(input.seed),
            scannedFiles: 1,
            threatLevel:
              verdict === "block"
                ? ("high" as const)
                : verdict === "warn"
                  ? ("medium" as const)
                  : ("none" as const),
            threatLevelDisplay: "none",
            summary: "summary",
            findings: Array.from({ length: findings }, (_, index) => ({
              id: `f${index}`,
              severity: "medium" as const,
              title: "t",
              message: "m",
            })) as never,
            rules: [],
            branches: [
              { name: "static" as const, status: "complete" as const },
            ],
            skippedFiles: [],
            categories: {},
            tokenUsage: {
              status: "not_applicable" as const,
              requestCount: 0,
              reportedRequestCount: 0,
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
              cachedInputTokens: 0,
              byModel: {},
              byBranch: {},
            },
          } as SecurityScanHistoryEntry["report"],
        }
      : {}),
  } as SecurityScanHistoryEntry;
}

test("projects the canonical overview from real discovery + history", () => {
  const skills = [skill("alpha", "a"), skill("beta", "b"), skill("gamma", "c")];
  // Run 1: alpha safe. Run 2: beta re-scanned safe (replaces nothing),
  // gamma warn with findings. Deleted "delta" history is scoped out.
  const history = [
    entry({
      scanId: "s1",
      seed: "a",
      skillName: "alpha",
      startedAt: "2026-09-01T00:00:00.000Z",
      finishedAt: "2026-09-01T00:01:00.000Z",
    }),
    entry({
      scanId: "s2",
      seed: "a",
      skillName: "alpha",
      startedAt: "2026-09-02T00:00:00.000Z",
      finishedAt: "2026-09-02T00:01:00.000Z",
    }),
    entry({
      scanId: "s2",
      seed: "b",
      skillName: "beta",
      verdict: "warn",
      findings: 2,
      startedAt: "2026-09-02T00:00:00.000Z",
      finishedAt: "2026-09-02T00:02:00.000Z",
    }),
    entry({
      scanId: "s2",
      seed: "d",
      skillName: "delta",
      verdict: "block",
      findings: 1,
      startedAt: "2026-09-02T00:00:00.000Z",
      finishedAt: "2026-09-02T00:03:00.000Z",
    }),
  ];
  const overview = projectSecurityOverview(
    history,
    skills,
    () => new Date("2026-09-03T00:00:00.000Z"),
  );
  assert.equal(overview.coverage, 2, "deleted Skill history stays out");
  assert.equal(overview.runCount, 2, "distinct scan runs");
  assert.equal(overview.totalSkills, 3);
  assert.equal(overview.summary?.assessedAssetCount, 2);
  assert.equal(overview.summary?.cleanCount, 1);
  assert.equal(overview.summary?.suspiciousCount, 1);
  assert.equal(overview.summary?.dangerousCount, 0);
});

test("resolveSecurityOverview marks the engine path available", async () => {
  const engine: SecurityEnginePort = {
    listSkills: async () => [skill("alpha", "a"), skill("beta", "b")],
    history: async () => [
      entry({
        scanId: "s1",
        seed: "a",
        skillName: "alpha",
        startedAt: "2026-09-01T00:00:00.000Z",
        finishedAt: "2026-09-01T00:01:00.000Z",
      }),
    ],
  };
  const overview = await resolveSecurityOverview({ engine });
  assert.equal(overview.available, true);
  assert.equal(overview.totalSkills, 2);
  assert.equal(overview.coverage, 1);
  assert.equal(overview.runCount, 1);
  assert.ok(overview.resolvedAt != null);
  assert.equal(overview.summary?.cleanCount, 1);
});

test("resolveSecurityOverview degrades to the history fallback without an engine", async () => {
  const overview = await resolveSecurityOverview({
    engine: null,
    fallback: async () => ({
      assessedAt: "2026-09-01T00:00:00.000Z",
      discoveredAssetCount: 1,
      assessedAssetCount: 1,
      failedAssetCount: 0,
      cleanCount: 1,
      suspiciousCount: 0,
      dangerousCount: 0,
      unknownCount: 0,
    }),
  });
  assert.equal(overview.available, false);
  assert.equal(overview.coverage, 0);
  assert.equal(overview.totalSkills, 0);
  assert.equal(overview.summary?.cleanCount, 1);
  assert.equal(overview.resolvedAt, null);
});

test("resolveSecurityOverview falls back when the engine read throws", async () => {
  const engine: SecurityEnginePort = {
    listSkills: async () => {
      throw new Error("engine hiccup");
    },
    history: async () => [],
  };
  const overview = await resolveSecurityOverview({
    engine,
    fallback: async () => null,
  });
  assert.equal(overview.available, false);
  assert.equal(overview.summary, null);
});
