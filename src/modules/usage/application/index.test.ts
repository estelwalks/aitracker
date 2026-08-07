import assert from "node:assert/strict";
import test from "node:test";
import { usageSnapshotFixture } from "../../../test-support/output-baseline.ts";
import type {
  SnapshotRepository,
  UsageCollectionRequest,
  UsageCollectionResult,
  UsageCollector,
  UsageSnapshotDto,
} from "../contracts.ts";
import {
  createUsageApplication,
  type UsageApplicationOptions,
} from "./index.ts";

function repository(initial?: UsageSnapshotDto) {
  let value = initial;
  let saves = 0;
  const repo: SnapshotRepository & { get saves(): number } = {
    get saves() {
      return saves;
    },
    async load() {
      return value;
    },
    async save(snapshot) {
      saves += 1;
      value = snapshot;
    },
  };
  return repo;
}

function collector(
  outcome: UsageCollectionResult | Error,
): UsageCollector & { requests: UsageCollectionRequest[] } {
  const requests: UsageCollectionRequest[] = [];
  return {
    requests,
    async collect(request = {}) {
      requests.push(request);
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  };
}

function options(
  repo: SnapshotRepository,
  scan: UsageCollector,
  now = Date.parse("2026-08-06T01:00:00.000Z"),
): UsageApplicationOptions {
  return { repository: repo, collector: scan, clock: { now: () => now } };
}

const healthyResult: UsageCollectionResult = {
  snapshot: usageSnapshotFixture,
  health: {
    status: "healthy",
    sourceCount: 1,
    availableSourceCount: 1,
    failedSourceCount: 0,
    diagnostics: [],
  },
  durationMs: 4,
  budgetExhausted: false,
  cancelled: false,
  retainedPreviousSnapshot: false,
};

test("GetUsageSnapshot marks fresh, stale, and empty snapshots", async () => {
  const now = Date.parse("2026-08-06T01:00:00.000Z");
  const fresh = createUsageApplication(
    options(repository(usageSnapshotFixture), collector(healthyResult), now),
  );
  const freshResult = await fresh.getUsageSnapshot({
    maxAgeMs: 2 * 60 * 60 * 1000,
  });
  assert.equal(freshResult.ok, true);
  if (freshResult.ok) assert.equal(freshResult.value.state, "fresh");
  const staleResult = await fresh.getUsageSnapshot({ maxAgeMs: 1 });
  assert.equal(staleResult.ok, true);
  if (staleResult.ok) assert.equal(staleResult.value.state, "stale");

  const empty = createUsageApplication(
    options(repository(), collector(healthyResult), now),
  );
  const emptyResult = await empty.getUsageSnapshot();
  assert.equal(emptyResult.ok, true);
  if (emptyResult.ok) assert.deepEqual(emptyResult.value, { state: "empty" });
});

test("RefreshUsage atomically commits a successful collection", async () => {
  const repo = repository();
  const scan = collector(healthyResult);
  const app = createUsageApplication(options(repo, scan));
  const result = await app.refreshUsage({ budget: { maxDurationMs: 1000 } });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.committed, true);
    assert.equal(result.value.retainedPreviousSnapshot, false);
    assert.equal(result.value.snapshot?.totals.totalTokens, 180);
  }
  assert.equal(repo.saves, 1);
  assert.equal(scan.requests.length, 1);
});

test("RefreshUsage retains the last successful snapshot on collector failure", async () => {
  const repo = repository(usageSnapshotFixture);
  const app = createUsageApplication(
    options(repo, collector(new Error("/private/path"))),
  );
  const result = await app.refreshUsage();
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.retainedPreviousSnapshot, true);
    assert.equal(result.value.reason, "collection-failed");
    assert.equal(
      result.value.snapshot?.generatedAt,
      usageSnapshotFixture.generatedAt,
    );
  }
  assert.equal(repo.saves, 0);
});

test("RefreshUsage exposes stable cancellation and budget outcomes", async () => {
  const cancelled = createUsageApplication(
    options(repository(usageSnapshotFixture), collector(healthyResult)),
  );
  const controller = new AbortController();
  controller.abort();
  const cancelledResult = await cancelled.refreshUsage({
    signal: controller.signal,
  });
  assert.equal(cancelledResult.ok, false);
  if (!cancelledResult.ok)
    assert.equal(cancelledResult.error.code, "errors.usage.cancelled");

  const budgetResult: UsageCollectionResult = {
    ...healthyResult,
    budgetExhausted: true,
    retainedPreviousSnapshot: true,
  };
  const repo = repository(usageSnapshotFixture);
  const budget = createUsageApplication(options(repo, collector(budgetResult)));
  const result = await budget.refreshUsage();
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.reason, "budget-exhausted");
  assert.equal(repo.saves, 0);
});

test("a retained/bad collection never overwrites the repository", async () => {
  const repo = repository(usageSnapshotFixture);
  const app = createUsageApplication(
    options(
      repo,
      collector({ ...healthyResult, retainedPreviousSnapshot: true }),
    ),
  );
  const result = await app.refreshUsage();
  assert.equal(result.ok, true);
  assert.equal(repo.saves, 0);
});
