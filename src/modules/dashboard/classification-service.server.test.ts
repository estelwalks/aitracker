import assert from "node:assert/strict";
import test from "node:test";

import type {
  ClassificationIndexEntry,
  ClassificationIndexRepository,
} from "./classification-index.server.ts";
import { createClassificationService } from "./classification-service.server.ts";
import type { IncrementalClassifier } from "./incremental-classifier.server.ts";

function repository(
  entries: readonly ClassificationIndexEntry[],
): ClassificationIndexRepository {
  const indexed = new Map(entries.map((entry) => [entry.ref, entry]));
  return {
    async get(ref) {
      return indexed.get(ref);
    },
    async getMany(refs) {
      return new Map(
        refs.flatMap((ref) => {
          const entry = indexed.get(ref);
          return entry ? [[ref, entry] as const] : [];
        }),
      );
    },
    async commit() {
      throw new Error("not implemented in test");
    },
    async needsClassification() {
      throw new Error("not implemented in test");
    },
    async clear() {
      throw new Error("not implemented in test");
    },
  };
}

const classifier = {} as IncrementalClassifier;

function entry(
  ref: string,
  kind: ClassificationIndexEntry["kind"],
  label: string,
): ClassificationIndexEntry {
  return {
    ref,
    kind,
    label,
    classifiedAt: "2026-08-20T00:00:00.000Z",
    fingerprint: null,
  };
}

test("resolve omits refs missing from the classification index", async () => {
  const service = createClassificationService({
    repository: repository([entry("indexed", "workspace", "Indexed")]),
    classifier,
  });

  const result = await service.resolve(["indexed", "missing"]);

  assert.deepEqual(
    [...result.entries()],
    [["indexed", { kind: "workspace", label: "Indexed" }]],
  );
  assert.equal(result.has("missing"), false);
});

test("resolve preserves an explicit unknown classification", async () => {
  const service = createClassificationService({
    repository: repository([entry("unknown", "unknown", "unknown")]),
    classifier,
  });

  const result = await service.resolve(["unknown"]);

  assert.deepEqual(result.get("unknown"), {
    kind: "unknown",
    label: "unknown",
  });
});
