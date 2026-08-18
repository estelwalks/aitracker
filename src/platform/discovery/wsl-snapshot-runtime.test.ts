import assert from "node:assert/strict";
import test from "node:test";

import { createWslSnapshotRuntime } from "./wsl-snapshot-runtime.server.ts";
import { createSnapshotEnvelopeRepository } from "../snapshot-runtime/envelope-repository.ts";
import type { AtomicJsonStore } from "../persistence/contracts.ts";
import type { SnapshotEnvelope } from "../snapshot-runtime/contracts.ts";
import type { WslTopology } from "./wsl-topology.server.ts";

const EMPTY: SnapshotEnvelope<WslTopology> = {
  schemaVersion: 1,
  revision: "empty",
  generatedAt: null,
  sourceFingerprint: null,
  status: "empty",
  data: null,
  diagnostics: {
    lastAttemptAt: null,
    lastSuccessAt: null,
    warningCodes: [],
  },
};

function memoryStore(
  initial: unknown,
): AtomicJsonStore<SnapshotEnvelope<WslTopology>> {
  let value = initial as SnapshotEnvelope<WslTopology> | null;
  return {
    async read() {
      return {
        value: value as SnapshotEnvelope<WslTopology>,
        source: value == null ? "default" : "stored",
        schemaVersion: 1,
      };
    },
    async write(next) {
      value = next;
    },
  };
}

const topology: WslTopology = {
  distros: [
    { distribution: "Ubuntu", home: "/home/dev" },
    { distribution: "Debian", home: "/home/debian" },
  ],
  enumeratedAt: "2026-08-18T00:00:00.000Z",
  failed: false,
  warningCodes: [],
};

test("T3-04: refresh commits topology and readLatest is O(1)", async () => {
  const repository = createSnapshotEnvelopeRepository({
    store: memoryStore(null),
    emptyEnvelope: EMPTY,
    schema: { currentVersion: 1, parse: (value) => value as never },
  });
  let calls = 0;
  const runtime = createWslSnapshotRuntime({
    repository,
    now: () => Date.parse("2026-08-18T00:10:00.000Z"),
    enumerate: async () => {
      calls += 1;
      return topology;
    },
  });
  await Promise.all([runtime.refreshNow(), runtime.refreshNow()]);
  assert.equal(calls, 1); // single-flight
  const latest = runtime.readLatest();
  assert.equal(latest.status, "fresh");
  assert.equal(latest.data?.distros.length, 2);
  assert.equal(latest.data?.distros[0].distribution, "Ubuntu");
});

test("T3-04: failed enumeration keeps last-known-good with a warning", async () => {
  const repository = createSnapshotEnvelopeRepository({
    store: memoryStore(null),
    emptyEnvelope: EMPTY,
    schema: { currentVersion: 1, parse: (value) => value as never },
  });
  const runtime = createWslSnapshotRuntime({
    repository,
    now: () => Date.parse("2026-08-18T00:10:00.000Z"),
    enumerate: async () => {
      throw new Error("wsl exploded");
    },
  });
  await runtime.refreshNow();
  const latest = runtime.readLatest();
  assert.equal(latest.data, null);
  assert.ok(latest.warningCodes.includes("collection-failed"));
});

test("T3-04: stale snapshot stays readable", async () => {
  const repository = createSnapshotEnvelopeRepository({
    store: memoryStore({
      schemaVersion: 1,
      revision: "r1",
      generatedAt: "2026-08-10T00:00:00.000Z",
      sourceFingerprint: null,
      status: "fresh",
      data: topology,
      diagnostics: {
        lastAttemptAt: "2026-08-10T00:00:00.000Z",
        lastSuccessAt: "2026-08-10T00:00:00.000Z",
        warningCodes: [],
      },
    }),
    emptyEnvelope: EMPTY,
    schema: { currentVersion: 1, parse: (value) => value as never },
  });
  const runtime = createWslSnapshotRuntime({
    repository,
    now: () => Date.parse("2026-08-18T00:10:00.000Z"),
    enumerate: async () => topology,
  });
  await runtime.ensureHydrated();
  assert.equal(runtime.readLatest().status, "stale");
  assert.equal(runtime.readLatest().data?.distros.length, 2);
});

test("T3-04: cancelled enumeration degrades gracefully", async () => {
  const controller = new AbortController();
  const repository = createSnapshotEnvelopeRepository({
    store: memoryStore(null),
    emptyEnvelope: EMPTY,
    schema: { currentVersion: 1, parse: (value) => value as never },
  });
  const runtime = createWslSnapshotRuntime({
    repository,
    now: () => Date.parse("2026-08-18T00:10:00.000Z"),
    enumerate: async (signal) => {
      signal?.throwIfAborted();
      return topology;
    },
  });
  controller.abort();
  await runtime.refreshNow(controller.signal);
  const latest = runtime.readLatest();
  // Cancelled refresh must not commit anything.
  assert.equal(latest.data, null);
});
