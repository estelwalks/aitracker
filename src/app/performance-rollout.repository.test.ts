import assert from "node:assert/strict";
import test from "node:test";

import {
  createPerformanceRolloutRepository,
  DEFAULT_PERFORMANCE_ROLLOUT_STATE,
  type PerformanceRolloutState,
} from "./performance-rollout.ts";
import type { AtomicJsonStore } from "../platform/persistence/contracts.ts";

interface MemoryStoreValue<T> {
  value: T;
  source: "stored" | "default";
  schemaVersion: number;
}

function createMemoryStore<T>(
  initial: T,
): AtomicJsonStore<T> & { readonly writes: number } {
  let current = initial;
  let writes = 0;
  return {
    writes,
    async read() {
      const result: MemoryStoreValue<T> = {
        value: current,
        source: current == null ? "default" : "stored",
        schemaVersion: 1,
      };
      return result;
    },
    async write(value) {
      current = value;
      writes += 1;
    },
  } as AtomicJsonStore<T> & { readonly writes: number };
}

const clock = { now: () => new Date("2026-08-18T10:00:00.000Z") };

test("repository read returns defaults for an empty store", async () => {
  const store = createMemoryStore<PerformanceRolloutState>(
    DEFAULT_PERFORMANCE_ROLLOUT_STATE,
  );
  const repo = createPerformanceRolloutRepository({ store, clock });
  const state = await repo.read();
  assert.deepEqual(state, DEFAULT_PERFORMANCE_ROLLOUT_STATE);
});

test("repository read recovers from corrupt state to legacy defaults", async () => {
  const store = createMemoryStore<PerformanceRolloutState>({
    bogus: true,
  } as unknown as PerformanceRolloutState);
  const repo = createPerformanceRolloutRepository({ store, clock });
  const state = await repo.read();
  assert.deepEqual(state, DEFAULT_PERFORMANCE_ROLLOUT_STATE);
});

test("setStage advances monotonically and persists", async () => {
  const store = createMemoryStore<PerformanceRolloutState>(
    DEFAULT_PERFORMANCE_ROLLOUT_STATE,
  );
  const repo = createPerformanceRolloutRepository({ store, clock });
  const advanced = await repo.setStage("shadow");
  assert.equal(advanced.stage, "shadow");
  assert.equal(advanced.updatedAt, "2026-08-18T10:00:00.000Z");
  const reloaded = await repo.read();
  assert.equal(reloaded.stage, "shadow");
});

test("setStage rejects backwards migration to a non-legacy stage", async () => {
  const store = createMemoryStore<PerformanceRolloutState>(
    DEFAULT_PERFORMANCE_ROLLOUT_STATE,
  );
  const repo = createPerformanceRolloutRepository({ store, clock });
  await repo.setStage("new-default");
  await assert.rejects(() => repo.setStage("shadow"), TypeError);
  await assert.rejects(() => repo.setStage("compact-read-model"), TypeError);
});

test("setStage allows rollback to legacy", async () => {
  const store = createMemoryStore<PerformanceRolloutState>(
    DEFAULT_PERFORMANCE_ROLLOUT_STATE,
  );
  const repo = createPerformanceRolloutRepository({ store, clock });
  await repo.setStage("compact-read-model");
  const rolledBack = await repo.setStage("legacy");
  assert.equal(rolledBack.stage, "legacy");
});

test("setForceLegacyReadPath persists the kill switch", async () => {
  const store = createMemoryStore<PerformanceRolloutState>(
    DEFAULT_PERFORMANCE_ROLLOUT_STATE,
  );
  const repo = createPerformanceRolloutRepository({ store, clock });
  const forced = await repo.setForceLegacyReadPath(true);
  assert.equal(forced.forceLegacyReadPath, true);
  const reloaded = await repo.read();
  assert.equal(reloaded.forceLegacyReadPath, true);
});
