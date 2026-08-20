import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createSqlitePerformanceRolloutRepository } from "../../app/sqlite-performance-rollout-repository.server.ts";
import { createSqliteCandidatePersistence } from "../../modules/distillation/infrastructure/sqlite-candidate-store.server.ts";
import { createSqliteDistillQuotaStore } from "../../modules/distillation/infrastructure/sqlite-quota-store.server.ts";
import { createSqliteKnowledgeRepository } from "../../modules/knowledge/infrastructure/sqlite-knowledge-repository.server.ts";
import { createSqliteReportStore } from "../../modules/reports/infrastructure/sqlite-report-store.server.ts";
import { createSqliteSecurityAssessmentHistoryStore } from "../../modules/security-assessment/infrastructure/sqlite-history-store.server.ts";
import { createSqliteDistributionRunStore } from "../../modules/skill-distribution/infrastructure/sqlite-run-store.server.ts";
import { DatabaseHost } from "./database-host.server.ts";
import { runMigrations } from "./migration-runner.server.ts";

function database(t: { after(callback: () => void): void }): DatabaseHost {
  const directory = mkdtempSync(join(tmpdir(), "tt-m4-assets-"));
  const host = DatabaseHost.open({
    path: join(directory, "platform.db"),
    versionsProvider: {
      getVersions: () => ({ nodeVersion: "24.19.0", sqliteVersion: "99.0.0" }),
    },
  });
  runMigrations({ database: host, appVersion: "test" });
  t.after(() => host.close());
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return host;
}

test("M4 repositories preserve report DTOs and atomic child rows", async (t) => {
  const store = createSqliteReportStore(database(t));
  const run = {
    runId: "run-1",
    definitionId: "reports.daily" as const,
    trigger: "manual" as const,
    status: "succeeded" as const,
    startedAt: "2026-08-19T00:00:00.000Z",
    finishedAt: "2026-08-19T00:00:01.000Z",
    evidence: [
      {
        module: "usage" as const,
        ref: "usage:safe",
        observedAt: "2026-08-19T00:00:00.000Z",
      },
    ],
  };
  await store.createRun(run);
  await store.saveDocument({
    reportId: "report-1",
    runId: run.runId,
    definitionId: run.definitionId,
    status: "draft",
    title: "Daily",
    body: "A privacy filtered daily summary.",
    generatedAt: "2026-08-19T00:00:01.000Z",
    templateVersion: 1,
    evidence: run.evidence,
    assets: [{ assetId: "knowledge:safe", kind: "knowledge" }],
  });
  assert.deepEqual(await store.listRuns(), [run]);
  assert.equal(
    (await store.getDocument("report-1"))?.assets[0]?.assetId,
    "knowledge:safe",
  );
  await assert.rejects(() =>
    store.saveDocument({
      reportId: "report-1",
      runId: run.runId,
      definitionId: run.definitionId,
      status: "draft",
      title: "Daily",
      body: "Bearer raw-secret",
      generatedAt: "2026-08-19T00:00:01.000Z",
      templateVersion: 1,
      evidence: [],
      assets: [],
    }),
  );
  assert.equal(
    (await store.getDocument("report-1"))?.body,
    "A privacy filtered daily summary.",
  );
});

test("knowledge revision conflicts and content privacy are enforced transactionally", async (t) => {
  const repository = createSqliteKnowledgeRepository({
    database: database(t),
    clock: { now: () => new Date("2026-08-19T01:00:00.000Z") },
    hash: { hash: () => "sha256:0123456789abcdef" as never },
  });
  const draft = await repository.createDraft(
    {
      assetId: "asset-1",
      kind: "memory",
      title: "Safe note",
      content: "ephemeral only",
      createdBy: "local-user",
      provenance: [
        {
          sourceRef: "session:opaque" as never,
          sourceType: "session",
          capturedAt: "2026-08-19T00:00:00.000Z",
        },
      ],
    },
    0,
  );
  assert.equal(draft.ok, true);
  const stale = await repository.approve("asset-1", "local-user", 0);
  assert.equal(stale.ok, false);
  const approved = await repository.approve("asset-1", "local-user", 1);
  assert.equal(approved.ok, true);
  assert.equal((await repository.listLatest()).ok, true);
  assert.equal((await repository.listVersions()).ok, true);
});

test("candidate, quota, assessment, distribution and rollout adapters round-trip safe DTOs", async (t) => {
  const host = database(t);
  const candidates = createSqliteCandidatePersistence(host);
  const candidate = {
    candidateId: "candidate-1",
    kind: "memory" as const,
    title: "Memory",
    summary: "Privacy filtered candidate summary.",
    mode: "offline" as const,
    approvalState: "waiting-approval" as const,
    selectedSessionRefs: [{ source: "codex", sessionId: "opaque-1" }],
    generatedAt: "2026-08-19T02:00:00.000Z",
    execution: {
      requestId: "request-1",
      modelId: "offline",
      promptVersionId: "distill.summary",
      promptVersion: 1,
      status: "offline" as const,
      cost: {
        confidence: "unknown" as const,
        currency: "USD" as const,
        reason: "offline" as const,
      },
      usedFallback: true,
    },
  };
  await candidates.save(candidate);
  assert.deepEqual(await candidates.list(), [candidate]);
  await assert.rejects(() =>
    candidates.save({
      ...candidate,
      candidateId: "candidate-2",
      summary: "/Users/example/raw",
    }),
  );

  const quota = createSqliteDistillQuotaStore(host, {
    limit: 2,
    today: () => "2026-08-19",
  });
  assert.equal((await quota.increment("2026-08-19")).used, 1);
  assert.equal((await quota.increment("2026-08-19")).used, 2);

  const security = createSqliteSecurityAssessmentHistoryStore(host);
  const assessment = {
    assessmentRef: "assessment:a1" as const,
    assetRef: "asset:a1" as const,
    assetKind: "skill" as const,
    verdict: "suspicious" as const,
    findings: [
      {
        ref: "finding:f1" as const,
        severity: "medium" as const,
        status: "active" as const,
        evidenceRef: "evidence:e1" as const,
      },
    ],
    ruleVersion: { version: "rules.v1", provenance: "builtin" as const },
    assessedAt: "2026-08-19T02:00:00.000Z",
    evidenceCount: 1,
  };
  await security.save(assessment);
  assert.deepEqual(await security.latest("asset:a1"), assessment);

  const distribution = createSqliteDistributionRunStore(host);
  await distribution.append({
    runRef: "distribution-run:r1",
    planRef: "install-plan:p1",
    status: "rolled-back",
    startedAt: "2026-08-19T02:00:00.000Z",
    finishedAt: "2026-08-19T02:00:01.000Z",
    targets: [{ targetRef: "target:codex", status: "rolled-back" }],
  });
  assert.equal(
    Number(
      host
        .prepare("SELECT COUNT(*) AS count FROM distribution_run_targets")
        .get()!.count,
    ),
    1,
  );

  const rollout = createSqlitePerformanceRolloutRepository(host, {
    now: () => new Date("2026-08-19T03:00:00.000Z"),
  });
  assert.equal((await rollout.read()).stage, "new-default");
});
