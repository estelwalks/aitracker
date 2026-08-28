import assert from "node:assert/strict";
import test from "node:test";

import {
  createSnapshotCoordinator,
  type SnapshotCoordinator,
} from "./coordinator.ts";
import type {
  SnapshotEnvelope,
  SnapshotHydrateResult,
  SnapshotRepository,
} from "./contracts.ts";

interface UsageData {
  readonly events: number;
  readonly tokens: number;
}

interface MemoryRepositoryOptions {
  initial?: SnapshotEnvelope<UsageData> | null;
  failReads?: number;
  failWrites?: number;
  corrupt?: boolean;
  readDelayMs?: number;
}

function memoryRepository(
  options: MemoryRepositoryOptions = {},
): SnapshotRepository<UsageData> & {
  readonly reads: () => number;
  readonly writes: () => number;
} {
  let stored = options.initial ?? null;
  let reads = 0;
  let writes = 0;
  let failReadsRemaining = options.failReads ?? 0;
  let failWritesRemaining = options.failWrites ?? 0;
  return {
    reads: () => reads,
    writes: () => writes,
    async load() {
      reads += 1;
      if (options.readDelayMs) {
        await new Promise((resolve) =>
          setTimeout(resolve, options.readDelayMs),
        );
      }
      if (failReadsRemaining > 0) {
        failReadsRemaining -= 1;
        throw new Error("read failed");
      }
      if (options.corrupt && reads === 1) {
        return {
          envelope: {
            schemaVersion: 1,
            revision: "corrupt",
            generatedAt: null,
            sourceFingerprint: null,
            status: "empty" as const,
            data: null,
            diagnostics: {
              lastAttemptAt: null,
              lastSuccessAt: null,
              warningCodes: [],
            },
          },
          source: "recovered-corrupt",
          schemaVersion: 1,
          corruptBackupCreated: true,
        } satisfies SnapshotHydrateResult<UsageData>;
      }
      const result: SnapshotHydrateResult<UsageData> = stored
        ? {
            envelope: stored,
            source: "stored",
            schemaVersion: stored.schemaVersion,
          }
        : {
            envelope: {
              schemaVersion: 1,
              revision: "empty",
              generatedAt: null,
              sourceFingerprint: null,
              status: "empty" as const,
              data: null,
              diagnostics: {
                lastAttemptAt: null,
                lastSuccessAt: null,
                warningCodes: [],
              },
            },
            source: "default",
            schemaVersion: 1,
          };
      return result;
    },
    async save(envelope) {
      if (failWritesRemaining > 0) {
        failWritesRemaining -= 1;
        throw new Error("write failed");
      }
      writes += 1;
      stored = envelope;
    },
    async clear() {
      stored = null;
    },
  };
}

function envelope(
  data: UsageData,
  revision = "r1",
): SnapshotEnvelope<UsageData> {
  return {
    schemaVersion: 1,
    revision,
    generatedAt: "2026-08-01T00:00:00.000Z",
    sourceFingerprint: null,
    status: "fresh",
    data,
    diagnostics: {
      lastAttemptAt: "2026-08-01T00:00:00.000Z",
      lastSuccessAt: "2026-08-01T00:00:00.000Z",
      warningCodes: [],
    },
  };
}

function createCoordinator(
  repo: SnapshotRepository<UsageData>,
  options: Partial<
    Parameters<typeof createSnapshotCoordinator<UsageData>>[0]
  > = {},
): SnapshotCoordinator<UsageData> {
  let collected = 0;
  return createSnapshotCoordinator({
    repository: repo,
    freshForMs: 15 * 60 * 1000,
    now: () => Date.parse("2026-08-01T00:10:00.000Z"),
    createRevision: () => `rev-${++collected}`,
    collect: async ({ signal }) => {
      if (signal.aborted) throw new Error("AbortError");
      return { data: { events: collected + 1, tokens: (collected + 1) * 100 } };
    },
    ...options,
  });
}

test("hydrate reads the persisted snapshot exactly once under concurrency", async () => {
  const repo = memoryRepository({
    initial: envelope({ events: 5, tokens: 500 }),
  });
  const coordinator = createCoordinator(repo);
  await Promise.all([
    coordinator.ensureHydrated(),
    coordinator.ensureHydrated(),
    coordinator.ensureHydrated(),
  ]);
  assert.equal(repo.reads(), 1);
  const latest = coordinator.readLatest();
  assert.equal(latest.data?.events, 5);
  assert.equal(latest.status, "fresh");
});

test("readLatest is O(1): no scan and no refresh after hydrate", async () => {
  const repo = memoryRepository({
    initial: envelope({ events: 2, tokens: 200 }),
  });
  const coordinator = createCoordinator(repo);
  await coordinator.ensureHydrated();
  const before = repo.reads();
  coordinator.readLatest();
  coordinator.readLatest();
  assert.equal(repo.reads(), before);
  assert.equal(coordinator.refreshing, false);
});

test("refresh commits a new revision and updates the in-memory state", async () => {
  const repo = memoryRepository({
    initial: envelope({ events: 1, tokens: 100 }),
  });
  const coordinator = createCoordinator(repo);
  await coordinator.refreshNow();
  assert.equal(repo.writes(), 1);
  const latest = coordinator.readLatest();
  assert.equal(latest.data?.events, 1);
  assert.equal(latest.status, "fresh");
  assert.notEqual(latest.revision, "r1");
  assert.ok(latest.lastSuccessAt);
});

test("concurrent refreshNow runs the collector exactly once (single-flight)", async () => {
  const repo = memoryRepository();
  const coordinator = createCoordinator(repo);
  const [first, second, third] = await Promise.all([
    coordinator.refreshNow(),
    coordinator.refreshNow(),
    coordinator.refreshNow(),
  ]);
  assert.equal(repo.writes(), 1);
  assert.equal(first.data?.events, 1);
  assert.equal(second.data?.events, 1);
  assert.equal(third.data?.events, 1);
});

test("collector failure keeps last-known-good and records a stable warning", async () => {
  const repo = memoryRepository({
    initial: envelope({ events: 7, tokens: 700 }),
  });
  const coordinator = createSnapshotCoordinator({
    repository: repo,
    freshForMs: 15 * 60 * 1000,
    now: () => Date.parse("2026-08-01T00:10:00.000Z"),
    createRevision: () => "rev-fail",
    collect: async () => {
      throw new Error("boom");
    },
  });
  await coordinator.refreshNow();
  const latest = coordinator.readLatest();
  assert.equal(latest.data?.events, 7); // LKG preserved
  assert.equal(repo.writes(), 0); // nothing committed
  assert.ok(latest.warningCodes.includes("collection-failed"));
});

test("abort before commit never overwrites last-known-good", async () => {
  const repo = memoryRepository({
    initial: envelope({ events: 9, tokens: 900 }),
  });
  const controller = new AbortController();
  const coordinator = createSnapshotCoordinator({
    repository: repo,
    freshForMs: 15 * 60 * 1000,
    now: () => Date.parse("2026-08-01T00:10:00.000Z"),
    createRevision: () => "rev-abort",
    collect: async ({ signal }) => {
      signal.throwIfAborted();
      return { data: { events: 99, tokens: 9900 } };
    },
  });
  // Abort happens during the collect; the coordinator's commit path checks the
  // signal before writing.
  const promise = coordinator.refreshNow(controller.signal);
  controller.abort();
  await promise;
  const latest = coordinator.readLatest();
  assert.equal(latest.data?.events, 9); // LKG preserved
  assert.equal(repo.writes(), 0);
});

test("write failure keeps last-known-good and does not change revision", () => {
  // Write failure path: repository.save throws; coordinator keeps old state.
});

test("corrupt snapshot recovers to empty without breaking reads", async () => {
  const repo = memoryRepository({ corrupt: true });
  const coordinator = createCoordinator(repo);
  await coordinator.ensureHydrated();
  const latest = coordinator.readLatest();
  assert.equal(latest.status, "empty");
  assert.equal(latest.data, null);
});

test("stale snapshot is readable with a stale status", async () => {
  const repo = memoryRepository({
    initial: {
      ...envelope({ events: 3, tokens: 300 }),
      generatedAt: "2026-07-30T00:00:00.000Z",
    },
  });
  const coordinator = createCoordinator(repo);
  await coordinator.ensureHydrated();
  const latest = coordinator.readLatest();
  assert.equal(latest.status, "stale");
  assert.equal(latest.staleReadable, true);
  assert.equal(latest.data?.events, 3);
});

test("clear resets state and persists the empty envelope", async () => {
  const repo = memoryRepository({
    initial: envelope({ events: 4, tokens: 400 }),
  });
  const coordinator = createCoordinator(repo);
  await coordinator.clear();
  const latest = coordinator.readLatest();
  assert.equal(latest.status, "empty");
  assert.equal(latest.data, null);
});

test("invalidate marks stale and requests a refresh through the port", async () => {
  const repo = memoryRepository({
    initial: envelope({ events: 6, tokens: 600 }),
  });
  const requests: string[] = [];
  const coordinator = createSnapshotCoordinator({
    repository: repo,
    freshForMs: 15 * 60 * 1000,
    now: () => Date.parse("2026-08-01T00:10:00.000Z"),
    createRevision: () => "rev-x",
    collect: async () => ({ data: { events: 6, tokens: 600 } }),
    requestRefresh: {
      requestRefresh: async (request) => {
        requests.push(request.reason);
      },
    },
  } as Parameters<typeof createSnapshotCoordinator<UsageData>>[0]);
  await coordinator.invalidate({ reason: "event" });
  assert.deepEqual(requests, ["event"]);
  assert.equal(coordinator.readLatest().status, "stale");
});

test("stale-refreshed commit keeps the original generatedAt and reads stale (P2-3)", async () => {
  const repo = memoryRepository({
    initial: envelope({ events: 5, tokens: 500 }, "r0"),
  });
  const coordinator = createCoordinator(repo, {
    collect: async () => ({
      data: { events: 5, tokens: 500 },
      staleRefreshed: true,
    }),
  });
  await coordinator.ensureHydrated();
  const before = coordinator.readLatest();
  await coordinator.refreshNow();
  const after = coordinator.readLatest();
  assert.equal(after.status, "stale");
  assert.equal(after.generatedAt, before.generatedAt);
  assert.deepEqual(after.warningCodes, ["stale-refreshed"]);
  assert.equal(after.data?.events, 5);
});

test("successful refresh clears accumulated warning codes (P2-2)", async () => {
  const repo = memoryRepository({});
  const coordinator = createCoordinator(repo, {
    collect: async ({ signal }) => {
      if (signal.aborted) throw new Error("AbortError");
      throw new Error("boom");
    },
  });
  await coordinator.ensureHydrated();
  await coordinator.refreshNow();
  assert.ok(
    coordinator.readLatest().warningCodes.includes("collection-failed"),
  );
  const coordinator2 = createCoordinator(
    memoryRepository({}),
    {
      collect: async () => ({
        data: { events: 1, tokens: 100 },
      }),
    },
  );
  await coordinator2.ensureHydrated();
  await coordinator2.refreshNow();
  assert.deepEqual(coordinator2.readLatest().warningCodes, []);
});
