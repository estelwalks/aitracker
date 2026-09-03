import assert from "node:assert/strict";
import test from "node:test";

import {
  RuntimePolicySourceSchema,
  SNAPSHOT_POLICY_KEYS,
  SNAPSHOT_TO_JOB,
  type RuntimePolicySource,
} from "./runtime-policy.schema.ts";
import raw from "./runtime-policy.source.json";

const VALID = raw as RuntimePolicySource;

function clone(value: RuntimePolicySource): RuntimePolicySource {
  return structuredClone(value);
}

test("runtime policy accepts the embedded source", () => {
  const parsed = RuntimePolicySourceSchema.parse(raw);
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.snapshotPolicies.exchangeRates.freshForMinutes, 1440);
  assert.equal(
    parsed.snapshotPolicies.exchangeRates.defaultRefreshMinutes,
    1440,
  );
  assert.equal(parsed.snapshotPolicies.usage.freshForMinutes, 5);
  assert.equal(parsed.snapshotPolicies.usage.defaultRefreshMinutes, 5);
  assert.equal(parsed.snapshotPolicies.sessions.freshForMinutes, 5);
  assert.equal(parsed.snapshotPolicies.skills.freshForMinutes, 60);
  assert.equal(parsed.snapshotPolicies.toolInstallations.freshForMinutes, 360);
  assert.equal(parsed.snapshotPolicies.wslTopology.freshForMinutes, 360);
  assert.equal(
    parsed.snapshotPolicies.skillMarketEvidence.freshForMinutes,
    360,
  );
  assert.deepEqual(parsed.resourceBudgets, {
    maxHeavyCollectors: 1,
    maxFileOperations: 16,
    maxProjectClassifiers: 8,
  });
  assert.equal(parsed.rollout.defaultStage, "new-default");
  assert.equal(parsed.scheduledJobs.tasks.length, 12);
  const insightRefresh = parsed.scheduledJobs.tasks.find(
    (task) => task.id === "insights.refresh",
  );
  assert.ok(insightRefresh);
  assert.deepEqual(insightRefresh.defaultSchedule, {
    kind: "interval",
    minutes: 60,
  });
  assert.equal(insightRefresh.startupPolicy, "if-stale");
  const usageRefresh = parsed.scheduledJobs.tasks.find(
    (task) => task.id === "usage.refresh",
  );
  assert.ok(usageRefresh);
  assert.deepEqual(usageRefresh.defaultSchedule, {
    kind: "interval",
    minutes: 5,
  });
  assert.equal(usageRefresh.constraints.minMinutes, 1);
  assert.equal(usageRefresh.constraints.singleFlight, true);
});

test("every snapshot policy key is present and has positive values", () => {
  const parsed = RuntimePolicySourceSchema.parse(raw);
  for (const key of SNAPSHOT_POLICY_KEYS) {
    const policy = parsed.snapshotPolicies[key];
    assert.ok(policy.freshForMinutes > 0);
    assert.ok(policy.defaultRefreshMinutes > 0);
    assert.ok(policy.timeoutMs >= 1000);
    assert.equal(typeof policy.staleReadable, "boolean");
    assert.equal(typeof policy.manualRefresh, "boolean");
  }
});

test("unknown top-level and nested fields are rejected", () => {
  const unknownTop = clone(VALID) as unknown as { extra?: unknown };
  unknownTop.extra = true;
  assert.throws(() => RuntimePolicySourceSchema.parse(unknownTop));

  const unknownPolicy = clone(VALID);
  (
    unknownPolicy.snapshotPolicies.usage as unknown as { bogus?: number }
  ).bogus = 1;
  assert.throws(() => RuntimePolicySourceSchema.parse(unknownPolicy));

  const unknownJob = clone(VALID);
  (unknownJob.scheduledJobs.tasks[0] as unknown as { bogus?: number }).bogus =
    1;
  assert.throws(() => RuntimePolicySourceSchema.parse(unknownJob));
});

test("removed legacy/shadow rollout stages are rejected", () => {
  const legacy = clone(VALID);
  legacy.rollout.defaultStage = "legacy" as never;
  assert.throws(() => RuntimePolicySourceSchema.parse(legacy));

  const shadow = clone(VALID);
  shadow.rollout.defaultStage = "shadow" as never;
  assert.throws(() => RuntimePolicySourceSchema.parse(shadow));
});

test("negative, zero and out-of-range values are rejected", () => {
  const negative = clone(VALID);
  negative.snapshotPolicies.usage.freshForMinutes = -1;
  assert.throws(() => RuntimePolicySourceSchema.parse(negative));

  const zero = clone(VALID);
  zero.snapshotPolicies.usage.defaultRefreshMinutes = 0;
  assert.throws(() => RuntimePolicySourceSchema.parse(zero));

  const oversized = clone(VALID);
  oversized.snapshotPolicies.skills.timeoutMs = 86_400_001;
  assert.throws(() => RuntimePolicySourceSchema.parse(oversized));

  const emptyBudget = clone(VALID);
  emptyBudget.resourceBudgets.maxFileOperations = 0;
  assert.throws(() => RuntimePolicySourceSchema.parse(emptyBudget));
});

test("duplicate task ids are rejected", () => {
  const duplicate = clone(VALID);
  duplicate.scheduledJobs.tasks[1].id = duplicate.scheduledJobs.tasks[0].id;
  assert.throws(() => RuntimePolicySourceSchema.parse(duplicate));
});

test("unregistered executors are rejected", () => {
  const bad = clone(VALID);
  bad.scheduledJobs.tasks[0].executorKey = "refresh-unknown-v9" as never;
  assert.throws(() => RuntimePolicySourceSchema.parse(bad));
});

test("snapshot refresh period must equal its scheduled job interval", () => {
  const mismatch = clone(VALID);
  mismatch.snapshotPolicies.usage.defaultRefreshMinutes = 30;
  assert.throws(() => RuntimePolicySourceSchema.parse(mismatch));
});

test("snapshot timeout must equal its scheduled job timeout", () => {
  const mismatch = clone(VALID);
  mismatch.snapshotPolicies.skills.timeoutMs = 999_000;
  assert.throws(() => RuntimePolicySourceSchema.parse(mismatch));
});

test("snapshot startup policy must equal its scheduled job startup policy", () => {
  const mismatch = clone(VALID);
  const job = mismatch.scheduledJobs.tasks.find(
    (task) => task.id === "sessions.refresh",
  );
  assert.ok(job);
  job.startupPolicy = "disabled";
  assert.throws(() => RuntimePolicySourceSchema.parse(mismatch));
});

test("every job-mapped snapshot policy has a matching interval job", () => {
  for (const [key, jobId] of Object.entries(SNAPSHOT_TO_JOB)) {
    const job = VALID.scheduledJobs.tasks.find((task) => task.id === jobId);
    assert.ok(job, `${key} must map to ${jobId}`);
    assert.equal(job!.defaultSchedule.kind, "interval");
    assert.equal(
      job!.defaultSchedule.minutes,
      VALID.snapshotPolicies[key as keyof typeof VALID.snapshotPolicies]
        .defaultRefreshMinutes,
    );
  }
});

test("interval outside constraints is rejected", () => {
  const bad = clone(VALID);
  bad.scheduledJobs.tasks[0].defaultSchedule = {
    kind: "interval",
    minutes: 1,
  };
  assert.throws(() => RuntimePolicySourceSchema.parse(bad));
});
