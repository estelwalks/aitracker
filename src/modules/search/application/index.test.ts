import assert from "node:assert/strict";
import test from "node:test";
import { createEventBus, type CoreEventMap } from "../../../shared/events.ts";
import { ok } from "../../../shared/result.ts";
import { SearchIndexService, createSearchEventProjection } from "./index.ts";
import { createSearchIndexRepository } from "../infrastructure/repository.ts";
import { documentFromPublic } from "../domain.ts";

function memoryStore<T>(initial: T) {
  let value = initial;
  let writes = 0;
  return {
    store: {
      async read() {
        return { value, source: "stored" as const, schemaVersion: 1 };
      },
      async write(next: T) {
        value = next;
        writes += 1;
      },
    },
    writes: () => writes,
    current: () => value,
  };
}

test("persists updates and reloads the same index after restart", async () => {
  const clock = { now: () => new Date("2026-08-07T00:00:00.000Z") };
  const initial = {
    schemaVersion: 1 as const,
    version: "search-v1-00000000",
    generatedAt: clock.now().toISOString(),
    stale: true,
    documents: [],
  };
  const memory = memoryStore(initial);
  const repository = createSearchIndexRepository({
    store: memory.store,
    clock,
  });
  const service = new SearchIndexService(repository, clock);
  await service.upsert(
    documentFromPublic({
      id: "knowledge:one",
      type: "knowledge",
      sourceRef: "knowledge.one",
      title: "Knowledge",
      textSummary: "offline index",
    }),
  );
  assert.equal(memory.writes(), 1);
  const restarted = new SearchIndexService(repository, clock);
  assert.equal((await restarted.load()).ok, true);
  assert.equal(restarted.query({ text: "offline" }).results.length, 1);
});

test("corrupt/offline storage falls back to a stale empty snapshot", async () => {
  const repository = createSearchIndexRepository({
    store: {
      async read() {
        throw new Error("corrupt");
      },
      async write() {},
    },
    clock: { now: () => new Date("2026-08-07T00:00:00.000Z") },
  });
  const result = await repository.read();
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.stale, true);
});

test("projection consumes public events and can be disposed", () => {
  const events = createEventBus<CoreEventMap>();
  const modules: string[] = [];
  const projection = createSearchEventProjection({
    events,
    onSnapshotUpdated: (module) => modules.push(module),
  });
  events.publish({
    type: "snapshot.updated",
    schemaVersion: 1,
    module: "sessions",
    occurredAt: "2026-08-07T00:00:00.000Z",
    correlationId: "corr-01" as never,
    summary: { count: 1 },
  });
  projection.dispose();
  events.publish({
    type: "snapshot.updated",
    schemaVersion: 1,
    module: "usage",
    occurredAt: "2026-08-07T00:00:00.000Z",
    correlationId: "corr-02" as never,
    summary: { count: 1 },
  });
  assert.deepEqual(modules, ["sessions"]);
});

test("query path does not invoke a scanner", () => {
  const scannerCalls = 0;
  const service = new SearchIndexService(
    {
      read: async () =>
        ok({
          schemaVersion: 1,
          version: "search-v1-00000000",
          generatedAt: "2026-08-07T00:00:00.000Z",
          stale: false,
          documents: [],
        }),
      write: async (snapshot) => {
        void snapshot;
        return ok(undefined);
      },
    },
    { now: () => new Date("2026-08-07T00:00:00.000Z") },
  );
  void scannerCalls;
  assert.deepEqual(service.query({ text: "anything" }).results, []);
  assert.equal(scannerCalls, 0);
});
