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
  // A genuine credential value shape is still rejected...
  const credential = createSnapshot(
    [
      documentFromPublic({
        id: "bad",
        type: "finding",
        sourceRef: "finding.bad",
        title: "bad",
        textSummary: "api_key: sk-abc123def456ghi789jkl",
      }),
    ],
    "2026-08-07T00:00:00.000Z",
  );
  assert.equal(credential.documents.length, 0);
  assert.equal(credential.skipped, 1);

  // ...and so is an absolute user path.
  const path = createSnapshot(
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
  );
  assert.equal(path.documents.length, 0);
  assert.equal(path.skipped, 1);
});

test("P1-9: standalone technical words in titles/summaries are legal index terms", () => {
  const snapshot = createSnapshot(
    [
      documentFromPublic({
        id: "session:token-stats",
        type: "session",
        sourceRef: "session.token-stats",
        title: "Token 使用统计",
        tags: ["token"],
        textSummary: "本月 token 消耗与 prompt 工程实践",
      }),
      documentFromPublic({
        id: "skill:prompt-eng",
        type: "skill",
        sourceRef: "skill.prompt-eng",
        title: "prompt 工程",
        tags: ["prompt"],
        textSummary: "如何撰写高质量 prompt 模板",
      }),
      documentFromPublic({
        id: "knowledge:content",
        type: "knowledge",
        sourceRef: "knowledge.content",
        title: "Content 策略",
        textSummary: "content 与 response 的关系",
      }),
    ],
    "2026-08-07T00:00:00.000Z",
  );
  assert.equal(snapshot.documents.length, 3);
  assert.equal(snapshot.skipped, 0);
});

test("P1-9: a path or credential-shaped title is skipped, not fatal", () => {
  const path = createSnapshot(
    [
      documentFromPublic({
        id: "agent:leak",
        type: "agent",
        sourceRef: "agent.leak",
        title: "/Users/alice/secret.txt",
        textSummary: "safe",
      }),
      documentFromPublic({
        id: "agent:ok",
        type: "agent",
        sourceRef: "agent.ok",
        title: "正常 Agent",
        textSummary: "safe",
      }),
    ],
    "2026-08-07T00:00:00.000Z",
  );
  assert.deepEqual(
    path.documents.map((document) => document.id),
    ["agent:ok"],
  );
  assert.equal(path.skipped, 1);

  const credential = createSnapshot(
    [
      documentFromPublic({
        id: "agent:key-leak",
        type: "agent",
        sourceRef: "agent.key-leak",
        title: "api_key: sk-abc123def456ghi789jkl",
        textSummary: "safe",
      }),
    ],
    "2026-08-07T00:00:00.000Z",
  );
  assert.equal(credential.documents.length, 0);
  assert.equal(credential.skipped, 1);
});

test("a snapshot with no skipped documents reports skipped: 0", () => {
  const snapshot = createSnapshot(docs, "2026-08-07T00:00:00.000Z");
  assert.equal(snapshot.skipped, 0);
});
