import assert from "node:assert/strict";
import test from "node:test";

import type { Clock } from "../../platform/persistence/contracts.ts";
import type { KnowledgeDocument } from "./contracts.ts";
import { createKnowledgeRepository } from "./application/index.ts";
import {
  archiveMemoryEntry,
  createMemoryEntry,
  listMemoryAssetsFrom,
  toMemoryEntry,
  type KnowledgeScope,
} from "./api.server.ts";
import {
  validateArchiveMemoryInput,
  validateCreateMemoryInput,
} from "./query.ts";

interface DocumentStore<T> {
  read(): Promise<{ value: T; source: "stored"; schemaVersion: number }>;
  write(value: T): Promise<void>;
}

function fixture() {
  let value: KnowledgeDocument = {
    schemaVersion: 1,
    revision: 0,
    assets: [],
    versions: [],
  };
  const store: DocumentStore<KnowledgeDocument> = {
    async read() {
      return { value, source: "stored", schemaVersion: 1 };
    },
    async write(next) {
      value = next;
    },
  };
  const clock: Clock = { now: () => new Date("2026-08-07T00:00:00.000Z") };
  // Hex-encoded hash so the repository's content-hash format validation passes
  // regardless of the content text (spaces etc. are rejected by the schema).
  const hash = {
    hash: (text: string) =>
      `hash-${Buffer.from(text).toString("hex").slice(0, 64)}` as never,
  };
  const repository = createKnowledgeRepository({ store, clock, hash });
  const scope: KnowledgeScope = { knowledge: repository };
  return { repository, scope };
}

test("distilled versions project the persisted memory body, never conversation content", async () => {
  const { repository, scope } = fixture();
  const draft = await repository.createDraft({
    kind: "memory",
    title: "Distilled note",
    content: "Distilled memory about node_modules handling",
    persistContent: true,
    provenance: [
      {
        sourceRef: "session:claude-code:abc123" as never,
        sourceType: "session",
        capturedAt: "2026-08-06T10:00:00.000Z",
        summary: "Distilled from selected session metadata",
      },
    ],
    createdBy: "user",
  });
  assert.equal(draft.ok, true);
  if (!draft.ok) return;
  await repository.approve(draft.value.assetId, "user");

  const entries = (await listMemoryAssetsFrom(scope)).entries;
  assert.equal(entries.length, 1);
  const entry = entries[0];
  assert.equal(entry.assetId, draft.value.assetId);
  assert.equal(entry.origin, "distill");
  assert.equal(entry.source, "distill");
  assert.equal(entry.summary, "Distilled from selected session metadata");
  // FR-014: the hub carries the full distilled memory body, not a fragment.
  assert.equal(entry.body, "Distilled memory about node_modules handling");
  // Raw conversation content never leaks into the read model.
  assert.equal(entry.body.includes("private conversation"), false);
  assert.equal(entry.summary.includes("private conversation"), false);
});

test("manual entries keep the decoded source/type/project and truncated summary", async () => {
  const { scope } = fixture();
  const created = await createMemoryEntry(
    {
      type: "task",
      title: "Keep components small",
      body: "A task memory about splitting components beyond 200 lines.",
      source: "Claude Code",
      project: "aitracker",
    },
    scope,
  );
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.entry?.origin, "manual");
  assert.equal(created.entry?.source, "Claude Code");
  assert.equal(created.entry?.type, "task");
  assert.equal(created.entry?.project, "aitracker");
  assert.equal(
    created.entry?.summary,
    "A task memory about splitting components beyond 200 lines.",
  );
  assert.equal(
    created.entry?.body,
    "A task memory about splitting components beyond 200 lines.",
  );
  assert.equal(created.entry?.status, "approved");

  const entries = (await listMemoryAssetsFrom(scope)).entries;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, "task");
});

test("update creates the next version with edited metadata and re-hashed body", async () => {
  const { scope } = fixture();
  const created = await createMemoryEntry(
    {
      type: "profile",
      title: "Original title",
      body: "original body text",
      source: "Codex",
    },
    scope,
  );
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const assetId = created.entry!.assetId;

  const { updateMemoryEntry } = await import("./api.server.ts");
  const updated = await updateMemoryEntry(
    {
      assetId,
      type: "profile",
      title: "Edited title",
      body: "edited body text",
      source: "Cursor",
      project: "sparkle",
    },
    scope,
  );
  assert.equal(updated.ok, true);
  if (!updated.ok) return;
  assert.equal(updated.entry?.title, "Edited title");
  assert.equal(updated.entry?.source, "Cursor");
  assert.equal(updated.entry?.project, "sparkle");
  assert.equal(updated.entry?.summary, "edited body text");
  assert.equal(updated.entry?.body, "edited body text");

  const entries = (await listMemoryAssetsFrom(scope)).entries;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, "Edited title");
});

test("archive soft-deletes the entry so it disappears from the memory list", async () => {
  const { scope } = fixture();
  const created = await createMemoryEntry(
    { type: "profile", title: "To archive", body: "short body" },
    scope,
  );
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const assetId = created.entry!.assetId;

  const archived = await archiveMemoryEntry(assetId, scope);
  assert.equal(archived.ok, true);
  const entries = (await listMemoryAssetsFrom(scope)).entries;
  assert.equal(entries.length, 0);
});

test("archive rejects an unknown asset id with a stable error code", async () => {
  const { scope } = fixture();
  const archived = await archiveMemoryEntry("asset-does-not-exist", scope);
  assert.deepEqual(archived, {
    ok: false,
    errorCode: "errors.memory.notFound",
  });
});

test("createMemory validator rejects empty and overlong titles and bodies", () => {
  assert.throws(
    () =>
      validateCreateMemoryInput({ type: "profile", title: "  ", body: "x" }),
    /errors.memory.invalidInput/,
  );
  assert.throws(
    () =>
      validateCreateMemoryInput({
        type: "profile",
        title: "t".repeat(257),
        body: "x",
      }),
    /errors.memory.invalidInput/,
  );
  assert.throws(
    () =>
      validateCreateMemoryInput({
        type: "profile",
        title: "ok",
        body: "b".repeat(24001),
      }),
    /errors.memory.invalidInput/,
  );
  assert.deepEqual(
    validateCreateMemoryInput({
      type: "profile",
      title: "ok",
      body: "b".repeat(24000),
    }),
    { type: "profile", title: "ok", body: "b".repeat(24000) },
  );
  assert.throws(
    () => validateCreateMemoryInput({ type: "bogus", title: "ok", body: "x" }),
    /errors.memory.invalidInput/,
  );
  assert.throws(
    () => validateCreateMemoryInput({ type: "profile" }),
    /errors.memory.invalidInput/,
  );
});

test("createMemory validator normalizes optional source/project and keeps valid input", () => {
  assert.deepEqual(
    validateCreateMemoryInput({
      type: "profile",
      title: "  Keep components small  ",
      body: " body ",
      source: "  Claude Code  ",
      project: "  aitracker  ",
    }),
    {
      type: "profile",
      title: "Keep components small",
      body: "body",
      source: "Claude Code",
      project: "aitracker",
    },
  );
  assert.deepEqual(
    validateCreateMemoryInput({ type: "task", title: "t", body: "b" }),
    { type: "task", title: "t", body: "b" },
  );
});

test("archiveMemory validator only accepts opaque asset ids", () => {
  assert.deepEqual(validateArchiveMemoryInput({ assetId: "asset-abc123" }), {
    assetId: "asset-abc123",
  });
  assert.throws(
    () => validateArchiveMemoryInput({ assetId: "" }),
    /errors.memory.invalidInput/,
  );
  assert.throws(
    () => validateArchiveMemoryInput({ assetId: "bad path/../x" }),
    /errors.memory.invalidInput/,
  );
  assert.throws(
    () => validateArchiveMemoryInput({ assetId: 42 }),
    /errors.memory.invalidInput/,
  );
});

test("toMemoryEntry defaults legacy entries safely (no content, no provenance)", () => {
  const entry = toMemoryEntry({
    versionId: "legacy:v1",
    assetId: "legacy",
    version: 1,
    kind: "memory",
    title: "Legacy note",
    contentRef: "content:hash",
    contentHash: "hash-x" as never,
    provenance: [],
    createdBy: "legacy",
    status: "approved",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    audit: { action: "import", actor: "legacy" },
  });
  assert.equal(entry.origin, "manual");
  assert.equal(entry.source, "unknown");
  assert.equal(entry.summary, "");
  assert.equal(entry.body, "");
  assert.equal(entry.type, "profile");
  assert.ok(!("content" in entry));
});
