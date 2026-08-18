import assert from "node:assert/strict";
import test from "node:test";

import { displayPaths } from "./installation-snapshot.contracts.ts";
import { createInstallationSnapshotRuntime } from "./installation-snapshot-runtime.server.ts";
import { createSnapshotEnvelopeRepository } from "../../platform/snapshot-runtime/envelope-repository.ts";
import type { AtomicJsonStore } from "../../platform/persistence/contracts.ts";
import type { SnapshotEnvelope } from "../../platform/snapshot-runtime/contracts.ts";
import type { InstallationSnapshotData } from "./installation-snapshot.contracts.ts";

const EMPTY: SnapshotEnvelope<InstallationSnapshotData> = {
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

function memoryStore<T>(initial: T): AtomicJsonStore<T> {
  let value = initial;
  return {
    async read() {
      return {
        value,
        source: value == null ? "default" : "stored",
        schemaVersion: 1,
      };
    },
    async write(next) {
      value = next;
    },
  };
}

test("T3-03: displayPaths converts HOME paths to ~/ and drops externals", () => {
  assert.deepEqual(displayPaths([], "/home/x"), []);
  assert.deepEqual(displayPaths(["/home/x/.claude"], "/home/x"), ["~/.claude"]);
  assert.deepEqual(
    displayPaths(["/home/x/.codex", "/etc/outside"], "/home/x"),
    ["~/.codex"],
  );
  assert.deepEqual(displayPaths(["C:\\Users\\x\\.claude"], "C:\\Users\\x"), [
    "~/.claude",
  ]);
});

test("T3-03: runtime refresh commits sanitized facts", async () => {
  const store = memoryStore<SnapshotEnvelope<InstallationSnapshotData>>(
    null as never,
  );
  const repository = createSnapshotEnvelopeRepository({
    store,
    emptyEnvelope: EMPTY,
    schema: { currentVersion: 1, parse: (value: unknown) => value as never },
  });
  const runtime = createInstallationSnapshotRuntime({
    repository,
    now: () => Date.parse("2026-08-01T00:10:00.000Z"),
    collect: async () => ({
      data: {
        generatedAt: "t",
        facts: [
          {
            id: "claude-code",
            installed: true,
            paths: ["~/.claude"],
            executableFound: true,
          },
          { id: "codex", installed: false, paths: [], executableFound: false },
        ],
      },
    }),
  });
  await runtime.refreshNow();
  const latest = runtime.readLatest();
  assert.equal(latest.status, "fresh");
  assert.equal(latest.data?.facts.length, 2);
  const claude = latest.data?.facts.find((fact) => fact.id === "claude-code");
  assert.ok(claude);
  assert.equal(claude.installed, true);
  assert.deepEqual(claude.paths, ["~/.claude"]);
  // No absolute paths may be persisted.
  assert.ok(!JSON.stringify(latest.data).includes("/home/"));
  assert.ok(!JSON.stringify(latest.data).includes("C:\\"));
});

test("T3-03: single-flight refresh and failure LKG", async () => {
  const store = memoryStore<SnapshotEnvelope<InstallationSnapshotData>>(
    null as never,
  );
  const repository = createSnapshotEnvelopeRepository({
    store,
    emptyEnvelope: EMPTY,
    schema: { currentVersion: 1, parse: (value: unknown) => value as never },
  });
  let calls = 0;
  const runtime = createInstallationSnapshotRuntime({
    repository,
    now: () => Date.parse("2026-08-01T00:10:00.000Z"),
    collect: async () => {
      calls += 1;
      return {
        data: {
          generatedAt: "t",
          facts: [
            { id: "x", installed: true, paths: [], executableFound: false },
          ],
        },
      };
    },
  });
  await Promise.all([
    runtime.refreshNow(),
    runtime.refreshNow(),
    runtime.refreshNow(),
  ]);
  assert.equal(calls, 1);

  const failing = createInstallationSnapshotRuntime({
    repository: createSnapshotEnvelopeRepository({
      store: memoryStore<SnapshotEnvelope<InstallationSnapshotData>>(
        null as never,
      ),
      emptyEnvelope: EMPTY,
      schema: { currentVersion: 1, parse: (value: unknown) => value as never },
    }),
    now: () => Date.parse("2026-08-01T00:10:00.000Z"),
    collect: async () => {
      throw new Error("probe failed");
    },
  });
  await failing.refreshNow();
  assert.ok(failing.readLatest().warningCodes.includes("collection-failed"));
  assert.equal(failing.readLatest().data, null);
});

test("T3-03: stale snapshot stays readable", async () => {
  const store = memoryStore<SnapshotEnvelope<InstallationSnapshotData>>({
    schemaVersion: 1,
    revision: "r1",
    generatedAt: "2026-07-30T00:00:00.000Z",
    sourceFingerprint: null,
    status: "fresh",
    data: {
      generatedAt: "2026-07-30T00:00:00.000Z",
      facts: [
        {
          id: "claude-code",
          installed: true,
          paths: ["~/.claude"],
          executableFound: true,
        },
      ],
    },
    diagnostics: {
      lastAttemptAt: "2026-07-30T00:00:00.000Z",
      lastSuccessAt: "2026-07-30T00:00:00.000Z",
      warningCodes: [],
    },
  } satisfies SnapshotEnvelope<InstallationSnapshotData>);
  const repository = createSnapshotEnvelopeRepository({
    store,
    emptyEnvelope: EMPTY,
    schema: { currentVersion: 1, parse: (value: unknown) => value as never },
  });
  const runtime = createInstallationSnapshotRuntime({
    repository,
    now: () => Date.parse("2026-08-01T00:10:00.000Z"),
    collect: async () => ({ data: { generatedAt: "t", facts: [] } }),
  });
  await runtime.ensureHydrated();
  assert.equal(runtime.readLatest().status, "stale");
  assert.equal(runtime.readLatest().data?.facts[0].installed, true);
});
