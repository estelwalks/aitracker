import assert from "node:assert/strict";
import test from "node:test";
import { createSnapshot, documentFromPublic, querySnapshot } from "./domain.ts";

const docs = [
  documentFromPublic({
    id: "agent:codex",
    type: "agent",
    sourceRef: "agent.codex",
    title: "Codex",
    tags: ["agent", "openai"],
    textSummary: "AI coding assistant",
    updatedAt: "2026-08-07T00:00:00.000Z",
  }),
  documentFromPublic({
    id: "skill:search",
    type: "skill",
    sourceRef: "skill.search",
    title: "Search skill",
    tags: ["search"],
    textSummary: "Find indexed assets",
    updatedAt: "2026-08-07T00:00:00.000Z",
  }),
  documentFromPublic({
    id: "report:old",
    type: "report",
    sourceRef: "report.old",
    title: "Old report",
    tags: ["report"],
    textSummary: "Archived report",
    freshness: "stale",
    updatedAt: "2026-08-01T00:00:00.000Z",
  }),
];

test("deduplicates documents and changes version fingerprint", () => {
  const first = createSnapshot(docs, "2026-08-07T00:00:00.000Z");
  const second = createSnapshot(
    [...docs, { ...docs[0], title: "Codex updated" }],
    "2026-08-07T00:00:00.000Z",
  );
  assert.equal(first.documents.length, 3);
  assert.equal(second.documents.length, 3);
  assert.notEqual(first.version, second.version);
});

test("query uses stable relevance ordering and stale filtering", () => {
  const snapshot = createSnapshot(docs, "2026-08-07T00:00:00.000Z");
  const result = querySnapshot(snapshot, { text: "search", limit: 10 });
  assert.deepEqual(
    result.results.map((item) => item.document.id),
    ["skill:search"],
  );
  assert.deepEqual(
    querySnapshot(snapshot, { text: "", includeStale: true }).results.map(
      (item) => item.document.id,
    ),
    ["agent:codex", "report:old", "skill:search"],
  );
});

test("rejects private fields and paths from public projection", () => {
  assert.throws(() =>
    createSnapshot(
      [
        documentFromPublic({
          id: "bad",
          type: "finding",
          sourceRef: "finding.bad",
          title: "bad",
          textSummary: "prompt=secret",
        }),
      ],
      "2026-08-07T00:00:00.000Z",
    ),
  );
  assert.throws(() =>
    createSnapshot(
      [
        documentFromPublic({
          id: "bad",
          type: "finding",
          sourceRef: "finding.bad",
          title: "bad",
          textSummary: "/Users/private/file",
        }),
      ],
      "2026-08-07T00:00:00.000Z",
    ),
  );
});
