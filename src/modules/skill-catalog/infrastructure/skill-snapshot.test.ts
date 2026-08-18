import assert from "node:assert/strict";
import test from "node:test";

import { toSkillSnapshotData } from "./skill-snapshot.contracts.ts";
import { createSkillSnapshotRuntime } from "./skill-snapshot-runtime.server.ts";
import { createSnapshotEnvelopeRepository } from "../../../platform/snapshot-runtime/envelope-repository.ts";
import type { AtomicJsonStore } from "../../../platform/persistence/contracts.ts";
import type { SnapshotEnvelope } from "../../../platform/snapshot-runtime/contracts.ts";
import type { SkillSnapshotData } from "./skill-snapshot.contracts.ts";
import type { SkillSnapshot as LegacySkillSnapshot } from "../../../lib/local-skills/types.ts";

const EMPTY: SnapshotEnvelope<SkillSnapshotData> = {
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

function legacySnapshot(): LegacySkillSnapshot {
  return {
    generatedAt: "2026-08-01T00:00:00.000Z",
    fingerprint: "fp-1",
    roots: {
      "Claude Code": ["/home/x/.claude/skills"],
      Codex: [],
    },
    agents: {
      "Claude Code": {
        installed: true,
        detectedPaths: ["/home/x/.claude/skills"],
      },
      Codex: { installed: false, detectedPaths: [] },
    },
    skills: [
      {
        id: "skill-1",
        name: "My Skill",
        description: "desc",
        lastUsedAt: null,
        sizeBytes: 1024,
        tokenEstimate: 256,
        installations: [
          {
            agent: "Claude Code",
            path: "/home/x/.claude/skills/my-skill",
            installedAt: "2026-07-01T00:00:00.000Z",
            modifiedAt: "2026-07-02T00:00:00.000Z",
            version: "1.0.0",
            source: {
              kind: "frontmatter",
              label: "local",
              url: null,
              repoOwner: null,
              repoName: null,
              repoPath: null,
              slug: null,
            },
            updateStatus: "current",
            updateReason: "",
          },
        ],
      },
    ],
    blacklist: [],
  };
}

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

test("T3-02: toSkillSnapshotData strips paths and detected roots", () => {
  const data = toSkillSnapshotData(legacySnapshot());
  assert.equal(data.roots["Claude Code"].count, 1);
  assert.deepEqual(data.agents["Claude Code"], { installed: true });
  assert.equal(data.skills.length, 1);
  assert.equal(data.skills[0].installations[0].agent, "Claude Code");
  // Paths and detectedPaths must never cross into the snapshot.
  const serialized = JSON.stringify(data);
  assert.ok(!serialized.includes("/home/"));
  assert.ok(!serialized.includes("detectedPaths"));
  assert.ok(!serialized.includes("skills/my-skill"));
  assert.equal(data.fingerprint, "fp-1");
});

test("T3-02: runtime refresh commits and single-flights", async () => {
  const store = memoryStore<SnapshotEnvelope<SkillSnapshotData>>(null as never);
  const repository = createSnapshotEnvelopeRepository({
    store,
    emptyEnvelope: EMPTY,
    schema: { currentVersion: 1, parse: (value: unknown) => value as never },
  });
  let collectCalls = 0;
  const runtime = createSkillSnapshotRuntime({
    repository,
    now: () => Date.parse("2026-08-01T00:10:00.000Z"),
    collect: async () => {
      collectCalls += 1;
      return {
        data: toSkillSnapshotData(legacySnapshot()),
        sourceFingerprint: "fp-1",
      };
    },
  });
  await Promise.all([runtime.refreshNow(), runtime.refreshNow()]);
  assert.equal(collectCalls, 1);
  const latest = runtime.readLatest();
  assert.equal(latest.status, "fresh");
  assert.equal(latest.data?.skills.length, 1);
  assert.equal(latest.data?.agents["Claude Code"].installed, true);
});

test("T3-02: collector failure keeps last-known-good", async () => {
  const store = memoryStore<SnapshotEnvelope<SkillSnapshotData>>(null as never);
  const repository = createSnapshotEnvelopeRepository({
    store,
    emptyEnvelope: EMPTY,
    schema: { currentVersion: 1, parse: (value: unknown) => value as never },
  });
  const runtime = createSkillSnapshotRuntime({
    repository,
    now: () => Date.parse("2026-08-01T00:10:00.000Z"),
    collect: async () => {
      throw new Error("boom");
    },
  });
  await runtime.refreshNow();
  assert.ok(runtime.readLatest().warningCodes.includes("collection-failed"));
});

test("T3-02: stale snapshot stays readable", async () => {
  const store = memoryStore<SnapshotEnvelope<SkillSnapshotData>>({
    schemaVersion: 1,
    revision: "r1",
    generatedAt: "2026-07-30T00:00:00.000Z",
    sourceFingerprint: "fp-old",
    status: "fresh",
    data: toSkillSnapshotData(legacySnapshot()),
    diagnostics: {
      lastAttemptAt: "2026-07-30T00:00:00.000Z",
      lastSuccessAt: "2026-07-30T00:00:00.000Z",
      warningCodes: [],
    },
  } satisfies SnapshotEnvelope<SkillSnapshotData>);
  const repository = createSnapshotEnvelopeRepository({
    store,
    emptyEnvelope: EMPTY,
    schema: { currentVersion: 1, parse: (value: unknown) => value as never },
  });
  const runtime = createSkillSnapshotRuntime({
    repository,
    now: () => Date.parse("2026-08-01T00:10:00.000Z"),
    collect: async () => ({ data: toSkillSnapshotData(legacySnapshot()) }),
  });
  await runtime.ensureHydrated();
  assert.equal(runtime.readLatest().status, "stale");
  assert.equal(runtime.readLatest().data?.skills.length, 1);
});
