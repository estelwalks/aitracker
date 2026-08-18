import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PERFORMANCE_ROLLOUT_STATE,
  isLegalRolloutMigration,
  parseRolloutStage,
  performanceRolloutSchema,
  resolvePerformanceRolloutStage,
  type PerformanceRolloutState,
  type PerformanceRolloutStage,
} from "./performance-rollout.ts";

const STAGES: readonly PerformanceRolloutStage[] = [
  "legacy",
  "shadow",
  "compact-read-model",
  "snapshot-read",
  "unified-refresh",
  "new-default",
];

test("legal migrations are monotonic forward or rollback to legacy", () => {
  for (const from of STAGES) {
    assert.equal(isLegalRolloutMigration(from, "legacy"), true);
    for (const to of STAGES) {
      const fromIndex = STAGES.indexOf(from);
      const toIndex = STAGES.indexOf(to);
      assert.equal(
        isLegalRolloutMigration(from, to),
        to === "legacy" || toIndex > fromIndex,
        `${from} -> ${to}`,
      );
    }
  }
});

test("parseRolloutStage accepts known stages and rejects garbage", () => {
  assert.equal(parseRolloutStage("shadow"), "shadow");
  assert.equal(parseRolloutStage("new-default"), "new-default");
  assert.equal(parseRolloutStage("unknown"), undefined);
  assert.equal(parseRolloutStage(42), undefined);
  assert.equal(parseRolloutStage(undefined), undefined);
});

test("emergency kill switch env wins over local state and default", () => {
  const state: PerformanceRolloutState = {
    ...DEFAULT_PERFORMANCE_ROLLOUT_STATE,
    stage: "new-default",
  };
  assert.equal(
    resolvePerformanceRolloutStage({
      envForceLegacy: "1",
      state,
      defaultStage: "legacy",
    }),
    "legacy",
  );
  assert.equal(
    resolvePerformanceRolloutStage({
      envForceLegacy: "true",
      state,
      defaultStage: "shadow",
    }),
    "legacy",
  );
});

test("persisted forceLegacyReadPath wins over stage", () => {
  const state: PerformanceRolloutState = {
    ...DEFAULT_PERFORMANCE_ROLLOUT_STATE,
    stage: "compact-read-model",
    forceLegacyReadPath: true,
  };
  assert.equal(
    resolvePerformanceRolloutStage({
      envForceLegacy: undefined,
      state,
      defaultStage: "legacy",
    }),
    "legacy",
  );
});

test("local state wins over policy default when no kill switch", () => {
  const state: PerformanceRolloutState = {
    ...DEFAULT_PERFORMANCE_ROLLOUT_STATE,
    stage: "shadow",
  };
  assert.equal(
    resolvePerformanceRolloutStage({
      envForceLegacy: undefined,
      state,
      defaultStage: "legacy",
    }),
    "shadow",
  );
});

test("missing or corrupt local state falls back to the policy default", () => {
  assert.equal(
    resolvePerformanceRolloutStage({
      envForceLegacy: undefined,
      state: undefined,
      defaultStage: "legacy",
    }),
    "legacy",
  );
  assert.equal(
    resolvePerformanceRolloutStage({
      envForceLegacy: undefined,
      state: undefined,
      defaultStage: "new-default",
    }),
    "new-default",
  );
});

test("schema rejects unknown fields and invalid stages", () => {
  assert.throws(() =>
    performanceRolloutSchema.parse({
      ...DEFAULT_PERFORMANCE_ROLLOUT_STATE,
      extra: true,
    }),
  );
  assert.throws(() =>
    performanceRolloutSchema.parse({
      ...DEFAULT_PERFORMANCE_ROLLOUT_STATE,
      stage: "bogus",
    }),
  );
  assert.throws(() =>
    performanceRolloutSchema.parse({
      ...DEFAULT_PERFORMANCE_ROLLOUT_STATE,
      forceLegacyReadPath: "yes",
    }),
  );
});
