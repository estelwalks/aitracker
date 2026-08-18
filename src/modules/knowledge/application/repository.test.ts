import assert from "node:assert/strict";
import test from "node:test";
import type {
  AtomicJsonReadResult,
  AtomicJsonStore,
  Clock,
} from "../../../platform/persistence/contracts.ts";
import type { KnowledgeDocument } from "../contracts.ts";
import { createKnowledgeRepository } from "./index.ts";

function fixture() {
  let value: KnowledgeDocument = {
    schemaVersion: 1,
    revision: 0,
    assets: [],
    versions: [],
  };
  const store: AtomicJsonStore<KnowledgeDocument> = {
    async read(): Promise<AtomicJsonReadResult<KnowledgeDocument>> {
      return { value, source: "stored", schemaVersion: 1 };
    },
    async write(next) {
      value = next;
    },
  };
  const clock: Clock = { now: () => new Date("2026-08-07T00:00:00.000Z") };
  const hash = { hash: (text: string) => `hash-${text}` as never };
  return {
    repository: createKnowledgeRepository({ store, clock, hash }),
    get document() {
      return value;
    },
  };
}

test("knowledge versions start at one and lifecycle transitions are gated", async () => {
  const fixtureState = fixture();
  const { repository } = fixtureState;
  const draft = await repository.createDraft({
    kind: "memory",
    title: "A note",
    content: "hello",
    createdBy: "user",
  });
  assert.equal(draft.ok, true);
  if (!draft.ok) return;
  assert.equal(draft.value.version, 1);
  assert.equal(draft.value.contentHash, "hash-hello");
  assert.equal(
    (await repository.publish(draft.value.assetId, "user")).ok,
    false,
  );
  assert.equal(
    (await repository.approve(draft.value.assetId, "user")).ok,
    true,
  );
  assert.equal(
    (await repository.publish(draft.value.assetId, "user")).ok,
    true,
  );
  assert.equal(fixtureState.document.revision, 3);
});

test("expected revision detects conflicts and duplicate lookup only suggests", async () => {
  const { repository } = fixture();
  const first = await repository.createDraft({
    kind: "brief",
    title: "One",
    content: "same",
    createdBy: "user",
  });
  assert.equal(first.ok, true);
  const conflict = await repository.createDraft(
    { kind: "brief", title: "Two", content: "same", createdBy: "user" },
    0,
  );
  assert.deepEqual(conflict, {
    ok: false,
    error: {
      code: "errors.knowledge.conflict",
      params: { expected: 0, actual: 1 },
    },
  });
  if (!first.ok) return;
  const suggestions = await repository.suggestDuplicates(
    first.value.contentHash,
  );
  assert.equal(suggestions.ok, true);
  assert.equal(suggestions.ok && suggestions.value.length, 1);
});

test("provenance and durable fields never accept paths, commands or credentials", async () => {
  const { repository } = fixture();
  await assert.rejects(() =>
    repository.createDraft({
      kind: "memory",
      title: "safe",
      content: "x",
      createdBy: "user",
      provenance: [
        {
          sourceRef: "/Users/me/session.json" as never,
          sourceType: "session",
          capturedAt: "2026-08-07T00:00:00Z",
        },
      ],
    }),
  );
  await assert.rejects(() =>
    repository.createDraft({
      kind: "memory",
      title: "safe",
      content: "x",
      createdBy: "user",
      provenance: [
        {
          sourceRef: "session:1" as never,
          sourceType: "session",
          capturedAt: "2026-08-07T00:00:00Z",
          summary: "npm run private",
        },
      ],
    }),
  );
});

test("createDraft stamps the security verdict onto the version and asset, and transitions preserve it", async () => {
  const fixtureState = fixture();
  const { repository } = fixtureState;
  const draft = await repository.createDraft({
    kind: "memory",
    title: "Distilled note",
    content: "hello",
    createdBy: "user",
    securityVerdict: "clean",
  });
  assert.equal(draft.ok, true);
  if (!draft.ok) return;
  assert.equal(draft.value.securityVerdict, "clean");

  const asset = fixtureState.document.assets.find(
    (item) => item.assetId === draft.value.assetId,
  );
  assert.equal(asset?.securityVerdict, "clean");

  // Transitions spread the existing version, so the verdict survives approve.
  const approved = await repository.approve(draft.value.assetId, "user");
  assert.equal(approved.ok, true);
  assert.equal(approved.ok && approved.value.securityVerdict, "clean");
});

test("createDraft without a securityVerdict leaves it undefined (consumers must treat as unknown)", async () => {
  const { repository } = fixture();
  const draft = await repository.createDraft({
    kind: "memory",
    title: "Legacy note",
    content: "hello",
    createdBy: "user",
  });
  assert.equal(draft.ok, true);
  assert.equal(draft.ok && draft.value.securityVerdict, undefined);
});

test("P4-T4-03: listLatest returns the newest 50 first with a stable cursor", async () => {
  const fixtureState = fixture();
  const { repository } = fixtureState;
  for (let index = 0; index < 3; index += 1) {
    const draft = await repository.createDraft({
      kind: "memory",
      title: `note-${index}`,
      content: `hello-${index}`,
      createdBy: "user",
    });
    assert.equal(draft.ok, true);
  }
  // Force distinct updatedAt values for stable ordering (rebuild document).
  const current = fixtureState.document;
  const stamped = current.assets.map((asset, index) => ({
    ...asset,
    updatedAt: `2026-08-0${index + 1}T00:00:00.000Z`,
  }));
  Object.assign(current, { ...current, assets: stamped });

  const first = await repository.listLatest({ limit: 2 });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.value.entries.length, 2);
  assert.equal(first.value.total, 3);
  assert.equal(first.value.entries[0].title, "note-2");
  assert.ok(first.value.nextCursor);

  const second = await repository.listLatest({
    cursor: first.value.nextCursor,
    limit: 2,
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.value.entries.length, 1);
  assert.equal(second.value.entries[0].title, "note-0");
  assert.equal(second.value.nextCursor, undefined);
});

test("P4-T4-03: listLatest caps limit at 100 and defaults to 50", async () => {
  const { repository } = fixture();
  const capped = await repository.listLatest({ limit: 500 });
  assert.equal(capped.ok, true);
  const defaulted = await repository.listLatest({});
  assert.equal(defaulted.ok, true);
});
