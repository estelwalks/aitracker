import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DatabaseError } from "../../../platform/database/contracts.ts";
import { DatabaseHost } from "../../../platform/database/database-host.server.ts";
import { runMigrations } from "../../../platform/database/migration-runner.server.ts";
import {
  createSqliteInsightRepository,
  type InsightEnhancementCache,
} from "./sqlite-insight-repository.server.ts";

function fixture(t: { after(fn: () => void): void }): DatabaseHost {
  const directory = mkdtempSync(join(tmpdir(), "aitracker-insight-repo-"));
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

function cache(
  cacheKey = "cache-a",
  analysis = "Review workload pressure",
): InsightEnhancementCache {
  return {
    cacheKey,
    surfaceId: "dashboard",
    scopeHash: "scope-hash",
    evidenceHash: "evidence-hash",
    locale: "en-US",
    profileId: null,
    promptVersionId: "page-insight",
    promptVersion: 1,
    modelLabel: "model",
    aiRequestId: null,
    generatedAtMs: 100,
    expiresAtMs: 200,
    status: "ready",
    lines: [
      {
        sequence: 0,
        candidateId: "candidate",
        analysis,
        actionId: "open-details",
      },
    ],
  };
}

test("surface preference overrides global", (t) => {
  const repository = createSqliteInsightRepository(fixture(t));
  const global = {
    scopeKey: "global",
    mode: "rules" as const,
    profileId: null,
    consentVersion: null,
    consentedAtMs: null,
    dailyCallLimit: null,
    updatedAtMs: 10,
  };
  repository.setPreference(global);
  repository.setPreference({
    ...global,
    scopeKey: "surface:dashboard",
    mode: "enhanced-manual",
    dailyCallLimit: 3,
    updatedAtMs: 11,
  });
  assert.equal(
    repository.getEffectivePreference("dashboard").mode,
    "enhanced-manual",
  );
  assert.equal(repository.getEffectivePreference("tracker").mode, "rules");
});

test("fresh databases default insight enhancement to enabled", (t) => {
  const repository = createSqliteInsightRepository(fixture(t));
  assert.deepEqual(repository.getEffectivePreference("dashboard"), {
    scopeKey: "global",
    mode: "enhanced-auto",
    profileId: null,
    consentVersion: "1",
    consentedAtMs: 0,
    dailyCallLimit: null,
    updatedAtMs: 0,
  });
});

test("refresh interval persists independently from insight mode", (t) => {
  const repository = createSqliteInsightRepository(fixture(t));
  assert.equal(repository.getRefreshIntervalMs(), 5 * 60 * 60 * 1000);
  repository.setRefreshIntervalMs(6 * 60 * 60 * 1000, 20);
  assert.equal(repository.getRefreshIntervalMs(), 6 * 60 * 60 * 1000);
  repository.setRefreshIntervalMs(5 * 60 * 60 * 1000, 19);
  assert.equal(
    repository.getRefreshIntervalMs(),
    6 * 60 * 60 * 1000,
    "older writes must not overwrite a newer interval",
  );
});

test("insight toggle preference persists local-rules and enhanced-auto modes", (t) => {
  const repository = createSqliteInsightRepository(fixture(t));
  const base = {
    scopeKey: "global",
    profileId: null,
    consentVersion: null,
    consentedAtMs: null,
    dailyCallLimit: null,
    updatedAtMs: 20,
  };

  repository.setPreference({ ...base, mode: "enhanced-auto", updatedAtMs: 21 });
  assert.equal(
    repository.getEffectivePreference("dashboard").mode,
    "enhanced-auto",
  );

  repository.setPreference({ ...base, mode: "rules", updatedAtMs: 22 });
  assert.equal(repository.getEffectivePreference("dashboard").mode, "rules");
});

test("rules mode writes no enhancement cache", (t) => {
  const host = fixture(t);
  const repository = createSqliteInsightRepository(host);
  assert.equal(
    repository.saveEnhancement({ mode: "rules", value: cache() }),
    false,
  );
  assert.equal(
    host.prepare("SELECT COUNT(*) AS n FROM insight_enhancement_cache").get()
      ?.n,
    0n,
  );
  assert.equal(
    host.prepare("SELECT COUNT(*) AS n FROM insight_enhancement_lines").get()
      ?.n,
    0n,
  );
});

test("enhancement cache enforces identity replacement, line ordering and TTL", (t) => {
  const host = fixture(t);
  const repository = createSqliteInsightRepository(host);
  assert.equal(
    repository.saveEnhancement({ mode: "enhanced-manual", value: cache() }),
    true,
  );
  const identity = cache();
  assert.equal(repository.findValid(identity, 199)?.cacheKey, "cache-a");
  assert.equal(repository.findValid(identity, 200), undefined);
  assert.equal(
    repository.saveEnhancement({
      mode: "enhanced-auto",
      value: { ...cache("cache-b"), expiresAtMs: 300 },
    }),
    true,
  );
  assert.equal(
    host.prepare("SELECT COUNT(*) AS n FROM insight_enhancement_cache").get()
      ?.n,
    1n,
  );
  assert.equal(repository.findValid(identity, 250)?.cacheKey, "cache-b");
  assert.equal(repository.pruneExpired(300), 1);
  assert.equal(
    host.prepare("SELECT COUNT(*) AS n FROM insight_enhancement_lines").get()
      ?.n,
    0n,
  );
});

test("latest valid enhancement is reused when current evidence has changed", (t) => {
  const repository = createSqliteInsightRepository(fixture(t));
  const previous = cache("cache-previous");
  assert.equal(
    repository.saveEnhancement({ mode: "enhanced-auto", value: previous }),
    true,
  );

  const current = {
    ...previous,
    cacheKey: "cache-current",
    evidenceHash: "new-evidence-hash",
    generatedAtMs: 150,
    expiresAtMs: 300,
  };
  assert.equal(
    repository.saveEnhancement({ mode: "enhanced-auto", value: current }),
    true,
  );

  assert.equal(
    repository.findLatestValid?.(
      { ...current, evidenceHash: "another-evidence-hash" },
      250,
    )?.cacheKey,
    "cache-current",
  );
  assert.equal(
    repository.findLatestValid?.(
      { ...current, evidenceHash: "another-evidence-hash" },
      300,
    ),
    undefined,
  );
});

test("model changes invalidate every ready enhancement cache", (t) => {
  const host = fixture(t);
  const repository = createSqliteInsightRepository(host);
  const first = cache("cache-first");
  const second = {
    ...cache("cache-second"),
    surfaceId: "tracker" as const,
    scopeHash: "tracker-scope",
    evidenceHash: "tracker-evidence",
  };
  assert.equal(
    repository.saveEnhancement({ mode: "enhanced-auto", value: first }),
    true,
  );
  assert.equal(
    repository.saveEnhancement({ mode: "enhanced-auto", value: second }),
    true,
  );
  assert.equal(repository.invalidateAll?.(), 2);
  assert.equal(repository.findValid(first, 150), undefined);
  assert.equal(repository.findValid(second, 150), undefined);
});

test("surface refresh invalidates only that page's enhancement cache", (t) => {
  const repository = createSqliteInsightRepository(fixture(t));
  const dashboard = cache("cache-dashboard");
  const tracker = {
    ...cache("cache-tracker"),
    surfaceId: "tracker" as const,
    scopeHash: "tracker-scope",
    evidenceHash: "tracker-evidence",
  };
  assert.equal(
    repository.saveEnhancement({ mode: "enhanced-auto", value: dashboard }),
    true,
  );
  assert.equal(
    repository.saveEnhancement({ mode: "enhanced-auto", value: tracker }),
    true,
  );

  assert.equal(repository.invalidateSurface?.("dashboard"), 1);
  assert.equal(repository.findValid(dashboard, 150), undefined);
  assert.equal(repository.findValid(tracker, 150)?.cacheKey, "cache-tracker");
});

test("refresh run start is atomic and concurrent starts reuse the active batch", (t) => {
  const repository = createSqliteInsightRepository(fixture(t));
  const items = [
    { surfaceId: "dashboard", scopeJson: "{}" },
    { surfaceId: "tracker", scopeJson: "{}" },
  ];
  const first = repository.startRefreshRun!({
    runId: "run-one",
    locale: "zh-CN",
    items,
    nowMs: 100,
  });
  const duplicate = repository.startRefreshRun!({
    runId: "run-two",
    locale: "zh-CN",
    items,
    nowMs: 101,
  });

  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.run.runId, "run-one");
  assert.equal(repository.getRefreshGeneration?.(), 1);
  assert.equal(repository.listRefreshItems?.("run-one").length, 2);
});

test("refresh item completion aggregates success, failure and skipped counts", (t) => {
  const repository = createSqliteInsightRepository(fixture(t));
  const items = [
    { surfaceId: "dashboard", scopeJson: "{}" },
    { surfaceId: "tracker", scopeJson: "{}" },
    { surfaceId: "security", scopeJson: "{}" },
  ];
  repository.startRefreshRun!({
    runId: "run-counts",
    locale: "en-US",
    items,
    nowMs: 200,
  });
  const outcomes = ["completed", "failed", "skipped"] as const;
  outcomes.forEach((status, index) => {
    assert.equal(
      repository.startRefreshItem!("run-counts", items[index], 201 + index),
      true,
    );
    repository.finishRefreshItem!({
      runId: "run-counts",
      item: items[index],
      status,
      resultStatus:
        status === "completed"
          ? "enhanced-ready"
          : status === "skipped"
            ? "no-eligible-candidates"
            : "enhancer-failed",
      nowMs: 210 + index,
    });
  });
  assert.deepEqual(repository.getRefreshRun?.("run-counts"), {
    runId: "run-counts",
    locale: "en-US",
    generation: 1,
    status: "completed",
    total: 3,
    completed: 1,
    failed: 1,
    skipped: 1,
    createdAtMs: 200,
    startedAtMs: 201,
    finishedAtMs: 212,
  });
});

test("generation reservation has a persistent unique key and records failure", (t) => {
  const repository = createSqliteInsightRepository(fixture(t));
  const identity = cache();
  const first = repository.claimGeneration!({
    reservationKey: "reservation-one",
    generation: 1,
    timeBucket: 2,
    identity,
    ownerId: "owner-one",
    createdAtMs: 300,
  });
  const duplicate = repository.claimGeneration!({
    reservationKey: "reservation-one",
    generation: 1,
    timeBucket: 2,
    identity,
    ownerId: "owner-two",
    createdAtMs: 301,
  });
  assert.equal(first.claimed, true);
  assert.equal(duplicate.claimed, false);
  assert.equal(duplicate.reservation.ownerId, "owner-one");
  assert.equal(
    repository.finishGeneration!({
      reservationKey: "reservation-one",
      ownerId: "owner-one",
      status: "failed",
      resultStatus: "timeout",
      nowMs: 302,
    }),
    true,
  );
  const afterFailure = repository.claimGeneration!({
    reservationKey: "reservation-one",
    generation: 1,
    timeBucket: 2,
    identity,
    ownerId: "owner-three",
    createdAtMs: 400,
  });
  // A failed reservation must not poison the refresh window: the next caller
  // re-claims it and retries the model call.
  assert.equal(afterFailure.claimed, true);
  assert.equal(afterFailure.reservation.ownerId, "owner-three");
  assert.equal(afterFailure.reservation.status, "running");

  // A completed reservation stays exclusive: the winner's cache is the
  // single source of truth until the refresh window rotates.
  assert.equal(
    repository.finishGeneration!({
      reservationKey: "reservation-one",
      ownerId: "owner-three",
      status: "completed",
      resultStatus: "enhanced-ready",
      nowMs: 401,
    }),
    true,
  );
  const afterCompletion = repository.claimGeneration!({
    reservationKey: "reservation-one",
    generation: 1,
    timeBucket: 2,
    identity,
    ownerId: "owner-four",
    createdAtMs: 402,
  });
  assert.equal(afterCompletion.claimed, false);
  assert.equal(afterCompletion.reservation.ownerId, "owner-three");
  assert.equal(afterCompletion.reservation.status, "completed");
});

test("privacy guard rejects facts, URLs, commands and current entity names atomically", (t) => {
  const host = fixture(t);
  const repository = createSqliteInsightRepository(host);
  for (const analysis of [
    "Used 42 calls",
    "Visit https://example.com",
    "Run npm install",
    "Focus on ProjectAlpha",
  ]) {
    assert.throws(
      () =>
        repository.saveEnhancement({
          mode: "enhanced-manual",
          value: cache(`cache-${analysis.length}`, analysis),
          forbiddenEntities: ["ProjectAlpha"],
        }),
      (error: unknown) =>
        error instanceof DatabaseError && error.code === "invalid-argument",
    );
  }
  assert.equal(
    host.prepare("SELECT COUNT(*) AS n FROM insight_enhancement_cache").get()
      ?.n,
    0n,
  );
});

test("recoverStaleState fails orphaned runs and reservations but keeps completed caches", (t) => {
  const host = fixture(t);
  const repository = createSqliteInsightRepository(host);
  const items = [
    { surfaceId: "dashboard", scopeJson: "{}" },
    { surfaceId: "tracker", scopeJson: "{}" },
  ];
  repository.startRefreshRun!({
    runId: "stale-run",
    locale: "zh-CN",
    items,
    nowMs: 100,
  });
  // Simulate a crash mid-batch: dashboard was running, tracker still queued.
  repository.startRefreshItem!("stale-run", items[0], 101);
  // A completed surface's cache must survive recovery untouched.
  const completed = cache("cache-completed");
  assert.equal(
    repository.saveEnhancement({ mode: "enhanced-auto", value: completed }),
    true,
  );
  // A reservation left `running` by the dead process.
  const identity = {
    surfaceId: "dashboard",
    scopeHash: "scope-hash",
    evidenceHash: "evidence-hash",
    locale: "en-US",
    profileId: null,
    promptVersionId: "page-insight",
    promptVersion: 1,
  };
  assert.equal(
    repository.claimGeneration!({
      reservationKey: "stale-reservation",
      generation: 1,
      timeBucket: 0,
      identity,
      ownerId: "dead-owner",
      createdAtMs: 102,
    }).claimed,
    true,
  );

  const recovered = repository.recoverStaleState!(200);
  assert.deepEqual(recovered, { runs: 1, items: 2, reservations: 1 });

  const run = repository.getRefreshRun?.("stale-run");
  assert.equal(run?.status, "completed");
  assert.equal(run?.finishedAtMs, 200);
  assert.equal(repository.hasActiveRefreshRun?.(), false);
  const itemViews = repository.listRefreshItems?.("stale-run") ?? [];
  assert.ok(
    itemViews.every(
      (item) => item.status === "failed" && item.resultStatus === "recovered",
    ),
  );
  assert.ok(
    itemViews.every((item) => item.resultDetail === "recovered"),
    "recovered items carry an explicit attribution",
  );
  // Completed caches are preserved, and the stale reservation is terminal.
  assert.equal(
    repository.findValid(completed, 150)?.cacheKey,
    "cache-completed",
  );
  const reservation = host
    .prepare(
      "SELECT status, result_status FROM insight_generation_reservations WHERE reservation_key = 'stale-reservation'",
    )
    .get();
  assert.equal(String(reservation?.status), "failed");
  assert.equal(String(reservation?.result_status), "recovered");

  // Idempotent: a second sweep has nothing left to recover.
  assert.deepEqual(repository.recoverStaleState!(201), {
    runs: 0,
    items: 0,
    reservations: 0,
  });
});

test("finishRefreshItem persists the failure attribution for settings display", (t) => {
  const repository = createSqliteInsightRepository(fixture(t));
  const items = [{ surfaceId: "dashboard", scopeJson: "{}" }];
  repository.startRefreshRun!({
    runId: "detail-run",
    locale: "zh-CN",
    items,
    nowMs: 100,
  });
  repository.startRefreshItem!("detail-run", items[0], 101);
  repository.finishRefreshItem!({
    runId: "detail-run",
    item: items[0],
    status: "failed",
    resultStatus: "enhancer-failed",
    resultDetail: "reasoning-only",
    nowMs: 102,
  });
  const views = repository.listRefreshItems?.("detail-run") ?? [];
  assert.equal(views[0]?.status, "failed");
  assert.equal(views[0]?.resultDetail, "reasoning-only");
  assert.equal(views[0]?.finishedAtMs, 102);
});
