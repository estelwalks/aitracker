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
