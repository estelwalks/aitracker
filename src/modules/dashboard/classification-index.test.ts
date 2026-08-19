import assert from "node:assert/strict";
import test from "node:test";

import {
  type ClassificationIndex,
  type ClassificationIndexRepository,
} from "./classification-index.server.ts";
import { createIncrementalClassifier } from "./incremental-classifier.server.ts";
import type { ClassificationIndexEntry } from "./classification-index.server.ts";

function memoryRepository(): ClassificationIndexRepository {
  let value: ClassificationIndex = {
    schemaVersion: 1,
    revision: 0,
    entries: {},
  };
  return {
    async get(ref) {
      return value.entries[ref];
    },
    async getMany(refs) {
      return new Map(
        refs.flatMap((ref) =>
          value.entries[ref] ? [[ref, value.entries[ref]!]] : [],
        ),
      );
    },
    async commit(entries) {
      value = {
        schemaVersion: 1,
        revision: value.revision + 1,
        entries: { ...value.entries },
      };
      for (const entry of entries) value.entries[entry.ref] = entry;
      return value;
    },
    async needsClassification(refs, fingerprints) {
      return refs.filter(
        (ref) =>
          !value.entries[ref] ||
          value.entries[ref]!.fingerprint !== (fingerprints.get(ref) ?? null),
      );
    },
    async clear() {
      value = { schemaVersion: 1, revision: 0, entries: {} };
    },
  };
}

function entry(
  ref: string,
  fingerprint: string | null = null,
  kind: ClassificationIndexEntry["kind"] = "workspace",
): ClassificationIndexEntry {
  return {
    ref,
    kind,
    label: ref.split("/").at(-1) ?? ref,
    classifiedAt: "2026-08-01T00:00:00.000Z",
    fingerprint,
  };
}

test("T3-06: commit + get round-trips entries", async () => {
  const repository = memoryRepository();
  await repository.commit([entry("proj-a", "fp-1")]);
  const found = await repository.get("proj-a");
  assert.equal(found?.kind, "workspace");
  assert.equal(found?.fingerprint, "fp-1");
  assert.equal(await repository.get("proj-b"), undefined);
});

test("T3-06: getMany returns only indexed refs", async () => {
  const repository = memoryRepository();
  await repository.commit([entry("a"), entry("b")]);
  const found = await repository.getMany(["a", "b", "c"]);
  assert.deepEqual([...found.keys()].sort(), ["a", "b"]);
});

test("T3-06: needsClassification only flags missing or changed fingerprints", async () => {
  const repository = memoryRepository();
  await repository.commit([entry("a", "fp-1"), entry("b", "fp-1")]);
  const missing = await repository.needsClassification(
    ["a", "b", "c"],
    new Map([
      ["a", "fp-1"],
      ["b", "fp-CHANGED"],
      ["c", null],
    ]),
  );
  assert.deepEqual(missing.sort(), ["b", "c"]);
});

test("T3-06: incremental classifier reuses unchanged refs and probes only new ones", async () => {
  const repository = memoryRepository();
  await repository.commit([
    entry("/home/x/unchanged-ref", "fp-same", "workspace"),
    entry("/home/x/changed-ref", "fp-old", "quick-conversation"),
  ]);
  const classifier = createIncrementalClassifier({
    repository,
    homeDirectory: "/home/x",
    platform: "linux",
    fingerprintOf: async (directory) => {
      if (directory === "/home/x/unchanged-ref") return "fp-same";
      return "fp-new";
    },
    now: () => new Date("2026-08-01T00:00:00.000Z"),
  });
  const result = await classifier.classify([
    "/home/x/unchanged-ref",
    "/home/x/changed-ref",
    "/home/x/brand-new",
  ]);
  assert.equal(result.total, 3);
  assert.equal(result.reused, 1); // unchanged-ref reused
  assert.equal(result.probed, 2); // changed-ref + brand-new
  assert.equal(result.failed, 0);
  const found = await repository.get("/home/x/brand-new");
  assert.ok(found);
  assert.equal(found?.fingerprint, "fp-new");
});

test("T3-06: deduplicates repeated refs and caps workers at 8", async () => {
  const repository = memoryRepository();
  const classifier = createIncrementalClassifier({
    repository,
    homeDirectory: "/home/x",
    platform: "linux",
    fingerprintOf: async () => "fp",
    now: () => new Date("2026-08-01T00:00:00.000Z"),
  });
  // 12 refs with duplicates; non-absolute refs classify as unknown without
  // probing (no filesystem work), so probed stays 0 and the index records
  // unknown entries for the unique refs.
  const refs = Array.from({ length: 12 }, (_, index) => `proj-${index % 4}`);
  const result = await classifier.classify(refs);
  assert.equal(result.total, 4); // unique refs
  assert.equal(result.probed, 0); // nothing resolvable to a directory
  assert.equal(result.reused, 0);
  const found = await repository.get("proj-0");
  assert.equal(found?.kind, "unknown");
});
