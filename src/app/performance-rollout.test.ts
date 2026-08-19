import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PERFORMANCE_ROLLOUT_STATE,
  isLegalRolloutMigration,
  parseRolloutStage,
  performanceRolloutSchema,
  resolvePerformanceRolloutStage,
  type PerformanceRolloutStage,
} from "./performance-rollout.ts";

const STAGES: readonly PerformanceRolloutStage[] = [
  "compact-read-model",
  "snapshot-read",
  "unified-refresh",
  "new-default",
];

test("legal migrations are strictly monotonic", () => {
  for (const from of STAGES) {
    for (const to of STAGES) {
      assert.equal(
        isLegalRolloutMigration(from, to),
        STAGES.indexOf(to) > STAGES.indexOf(from),
        `${from} -> ${to}`,
      );
    }
  }
});

test("removed file rollout stages are rejected", () => {
  assert.equal(parseRolloutStage("legacy"), undefined);
  assert.equal(parseRolloutStage("shadow"), undefined);
  assert.equal(parseRolloutStage("new-default"), "new-default");
  assert.equal(parseRolloutStage(42), undefined);
});

test("SQLite state wins over policy default", () => {
  assert.equal(
    resolvePerformanceRolloutStage({
      state: { ...DEFAULT_PERFORMANCE_ROLLOUT_STATE, stage: "snapshot-read" },
      defaultStage: "new-default",
    }),
    "snapshot-read",
  );
});

test("missing state uses the policy default", () => {
  assert.equal(
    resolvePerformanceRolloutStage({
      state: undefined,
      defaultStage: "new-default",
    }),
    "new-default",
  );
});

test("schema rejects unknown fields and removed stages", () => {
  assert.throws(() =>
    performanceRolloutSchema.parse({
      ...DEFAULT_PERFORMANCE_ROLLOUT_STATE,
      extra: true,
    }),
  );
  assert.throws(() =>
    performanceRolloutSchema.parse({
      ...DEFAULT_PERFORMANCE_ROLLOUT_STATE,
      stage: "legacy",
    }),
  );
  assert.throws(() =>
    performanceRolloutSchema.parse({
      ...DEFAULT_PERFORMANCE_ROLLOUT_STATE,
      forceLegacyReadPath: true,
    }),
  );
});
