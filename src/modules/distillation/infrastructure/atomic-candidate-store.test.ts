import assert from "node:assert/strict";
import test from "node:test";

import type { AtomicJsonStore } from "../../../platform/persistence/contracts.ts";
import type { AIExecutionResult } from "../../ai-orchestration/contracts.ts";
import type { CandidateOutput } from "../contracts.ts";
import {
  DEFAULT_DISTILL_CANDIDATE_FILE,
  PersistedCandidateSchema,
  createAtomicCandidateStore,
  type DistillCandidateFile,
} from "./atomic-candidate-store.ts";

/** In-memory AtomicJsonStore double mirroring the NodeAtomicJsonStore contract. */
function memoryStore(): {
  store: AtomicJsonStore<DistillCandidateFile>;
  peek: () => DistillCandidateFile;
} {
  let value: DistillCandidateFile = structuredClone(
    DEFAULT_DISTILL_CANDIDATE_FILE,
  );
  return {
    store: {
      async read() {
        return {
          value: structuredClone(value),
          source: "stored",
          schemaVersion: 1,
        };
      },
      async write(next: DistillCandidateFile) {
        value = structuredClone(next);
      },
    },
    peek: () => structuredClone(value),
  };
}

const execution = (
  status: AIExecutionResult["summary"]["status"] = "completed",
): AIExecutionResult => ({
  summary: {
    requestId: "distill:req-1",
    modelId: "model-a",
    providerId: status === "offline" ? "offline" : "provider-a",
    promptVersionId: "distillation.summary",
    promptVersion: 1,
    status,
    cost: {
      confidence: status === "completed" ? "estimated" : "unknown",
      currency: "USD",
      reason: status === "offline" ? "offline" : "estimated",
    },
    usedFallback: status !== "completed",
  },
  response: {
    providerId: status === "offline" ? "offline" : "provider-a",
    modelId: "model-a",
    text: "Distilled knowledge note.",
  },
});

const candidate = (
  id: string,
  generatedAt = "2026-08-07T00:01:00.000Z",
): CandidateOutput => {
  const result = execution();
  return {
    candidateId: id,
    kind: "memory",
    title: "Distilled summary (2 sessions)",
    summary: "Distilled knowledge note.",
    mode: "model",
    approvalState: "waiting-approval",
    selectedSessionRefs: [
      { source: "codex", sessionId: "s1" },
      { source: "codex", sessionId: "s2" },
    ],
    generatedAt,
    execution: result.summary,
  };
};

test("save persists a candidate and list round-trips it (newest first)", async () => {
  const { store, peek } = memoryStore();
  const persistence = createAtomicCandidateStore({ store });
  await persistence.save(candidate("candidate-1", "2026-08-07T00:01:00.000Z"));
  await persistence.save(candidate("candidate-2", "2026-08-07T00:02:00.000Z"));

  const listed = await persistence.list();
  assert.equal(listed.length, 2);
  assert.equal(listed[0]!.candidateId, "candidate-2");
  assert.equal(listed[1]!.candidateId, "candidate-1");
  // The underlying file mirrors the persisted list.
  assert.equal(peek().candidates.length, 2);
});

test("save upserts by candidate id (idempotent rewrite of the same candidate)", async () => {
  const { store, peek } = memoryStore();
  const persistence = createAtomicCandidateStore({ store });
  await persistence.save(candidate("candidate-1"));

  const updated = {
    ...candidate("candidate-1"),
    approvalState: "approved" as const,
  };
  await persistence.save(updated);

  const listed = await persistence.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0]!.approvalState, "approved");
  assert.equal(peek().candidates.length, 1);
});

test("list returns defensive copies so callers cannot mutate the persisted graph", async () => {
  const { store } = memoryStore();
  const persistence = createAtomicCandidateStore({ store });
  await persistence.save(candidate("candidate-1"));
  const [listed] = await persistence.list();
  (listed as { summary: string }).summary = "mutated";
  const [again] = await persistence.list();
  assert.equal(again!.summary, "Distilled knowledge note.");
});

test("schema rejects candidates carrying non-opaque ids or unknown fields", () => {
  const good = candidate("candidate-1");
  assert.equal(PersistedCandidateSchema.safeParse(good).success, true);

  const badId = { ...good, candidateId: "../escape" };
  assert.equal(PersistedCandidateSchema.safeParse(badId).success, false);

  const extra = { ...good, extraField: "x" };
  assert.equal(PersistedCandidateSchema.safeParse(extra).success, false);

  const badState = { ...good, approvalState: "somewhere" };
  assert.equal(PersistedCandidateSchema.safeParse(badState).success, false);
});
