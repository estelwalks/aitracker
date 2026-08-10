import assert from "node:assert/strict";
import test from "node:test";
import type { AIExecutionResult } from "../../ai-orchestration/contracts.ts";
import type {
  KnowledgeRepository,
  KnowledgeVersion,
} from "../../knowledge/contracts.ts";
import type { SessionSummary } from "../../sessions/contracts.ts";
import { createSessionQueryService } from "../../sessions/index.ts";
import { createDistillationApplication } from "./index.ts";

const session = (
  id: string,
  overrides: Partial<SessionSummary> = {},
): SessionSummary => ({
  sessionId: id,
  source: "codex",
  title: `Session ${id}`,
  projectKey: "demo",
  model: "model-a",
  startedAt: "2026-08-07T00:00:00.000Z",
  endedAt: "2026-08-07T00:01:00.000Z",
  durationMs: 60_000,
  turns: 3,
  editTurns: 1,
  retryTurns: 0,
  totals: {
    inputTokens: 1,
    outputTokens: 2,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 3,
  },
  cost: {
    knownUsd: 0,
    estimatedUsd: 0,
    cacheSavingsUsd: 0,
    pricedEvents: 0,
    estimatedEvents: 0,
    unknownEvents: 0,
    unknownModels: [],
    complete: true,
  },
  subagentCalls: 0,
  status: "available",
  statusReason: null,
  resumeAvailable: true,
  ...overrides,
});

const execution = (
  status: AIExecutionResult["summary"]["status"] = "completed",
  text = "safe candidate",
): AIExecutionResult => ({
  summary: {
    requestId: "req-1",
    modelId: "model-a",
    providerId: status === "offline" ? "offline" : "provider-a",
    promptVersionId: "distill",
    promptVersion: 1,
    status,
    cost: {
      confidence: status === "completed" ? "estimated" : "unknown",
      currency: "USD",
      reason: status === "offline" ? "offline" : "estimated",
    },
    usedFallback: status !== "completed",
  },
  response:
    status === "budget-exceeded"
      ? undefined
      : {
          providerId: status === "offline" ? "offline" : "provider-a",
          modelId: "model-a",
          text,
        },
});

function setup(
  aiResult: AIExecutionResult = execution(),
  rows: readonly SessionSummary[] = [session("s1"), session("s2")],
) {
  const calls: string[] = [];
  const knowledge = {
    async createDraft(
      input: Parameters<KnowledgeRepository["createDraft"]>[0],
    ) {
      calls.push(`create:${input.title}`);
      const version: KnowledgeVersion = {
        versionId: "asset-1:v1",
        assetId: "asset-1",
        version: 1,
        kind: input.kind,
        title: input.title,
        contentRef: "content:hash-1",
        contentHash: "hash-1" as never,
        provenance: input.provenance ?? [],
        createdBy: input.createdBy,
        status: "draft",
        createdAt: "2026-08-07T00:00:00.000Z",
        updatedAt: "2026-08-07T00:00:00.000Z",
        audit: { action: "draft", actor: input.actor ?? input.createdBy },
      };
      return { ok: true, value: version } as const;
    },
    async approve() {
      calls.push("approve");
      const version = {
        ...({} as KnowledgeVersion),
        versionId: "asset-1:v1",
        assetId: "asset-1",
        version: 1,
        kind: "memory" as const,
        title: "approved",
        contentRef: "content:hash-1",
        contentHash: "hash-1" as never,
        provenance: [],
        createdBy: "user",
        status: "approved" as const,
        createdAt: "2026-08-07T00:00:00.000Z",
        updatedAt: "2026-08-07T00:00:00.000Z",
        audit: { action: "approved", actor: "user" },
      };
      return { ok: true, value: version } as const;
    },
  } as unknown as KnowledgeRepository;
  const app = createDistillationApplication({
    sessions: createSessionQueryService({ list: async () => rows }),
    ai: { execute: async () => aiResult },
    knowledge,
    createCandidateId: () => "candidate-1",
    now: () => new Date("2026-08-07T00:02:00.000Z"),
  });
  return { app, calls };
}

const request = (overrides: Record<string, unknown> = {}) => ({
  requestId: "req-1",
  selection: {
    sessionRefs: [
      { source: "codex", sessionId: "s1" },
      { source: "codex", sessionId: "s2" },
    ],
  },
  modelId: "model-a",
  prompt: { id: "distill", version: 1, template: "Summarize metadata" },
  ...overrides,
});

test("selects requested sessions and reaches waiting-approval", async () => {
  let input = "";
  const state = setup();
  const app = createDistillationApplication({
    sessions: createSessionQueryService({
      list: async () => [session("s1"), session("s2")],
    }),
    ai: {
      execute: async (req) => {
        input = req.input.text;
        return execution();
      },
    },
    createCandidateId: () => "candidate-1",
  });
  const result = await app.start(request());
  assert.equal(result.ok, true);
  assert.match(input, /Session 1: codex:s1/);
  assert.equal(result.ok && result.value.status, "waiting-approval");
  assert.equal(
    result.ok && result.value.candidate?.approvalState,
    "waiting-approval",
  );
  void state;
});

test("filters missing and duplicate selections before model invocation", async () => {
  const { app } = setup();
  const invalid = await app.start(
    request({
      selection: {
        sessionRefs: [
          { source: "codex", sessionId: "s1" },
          { source: "codex", sessionId: "s1" },
        ],
      },
    }),
  );
  assert.equal(invalid.ok, false);
  const missing = await app.start(
    request({
      selection: { sessionRefs: [{ source: "codex", sessionId: "missing" }] },
    }),
  );
  assert.equal(missing.ok, false);
});

test("offline, model failure and budget exceeded remain explainable degraded candidates", async () => {
  for (const status of ["offline", "fallback", "budget-exceeded"] as const) {
    const { app } = setup(execution(status));
    const result = await app.start(request());
    assert.equal(result.ok, true);
    assert.equal(
      result.ok && result.value.candidate?.mode,
      status === "fallback" ? "fallback" : status,
    );
  }
});

test("approval is the only path that invokes knowledge; cancellation closes the gate", async () => {
  const state = setup();
  const started = await state.app.start(request());
  assert.equal(started.ok, true);
  assert.deepEqual(state.calls, []);
  const candidateId = started.ok ? started.value.candidate!.candidateId : "";
  const approved = await state.app.approve(candidateId, "user");
  assert.equal(approved.ok, true);
  assert.deepEqual(state.calls, [
    "create:Distilled summary (2 sessions)",
    "approve",
  ]);
  const cancelledState = setup();
  const cancelled = await cancelledState.app.start(request());
  assert.equal(cancelled.ok, true);
  const cancelId = cancelled.ok ? cancelled.value.candidate!.candidateId : "";
  const cancelledResult = await cancelledState.app.cancel(cancelId);
  assert.equal(cancelledResult.ok, true);
  assert.equal(cancelledResult.ok && cancelledResult.value.status, "cancelled");
  assert.deepEqual(cancelledState.calls, []);
  assert.equal((await setup().app.cancel("unknown")).ok, false);
  assert.equal((await state.app.cancel(candidateId)).ok, false);
});

test("sensitive titles and model responses are not retained in candidate output", async () => {
  const { app } = setup(
    execution("completed", "/Users/me/project; npm run private sk-123456789"),
    [
      session("s1", { title: "/home/me/secrets", projectKey: "C:\\\\private" }),
      session("s2"),
    ],
  );
  const result = await app.start(
    request({
      selection: { sessionRefs: [{ source: "codex", sessionId: "s1" }] },
    }),
  );
  assert.equal(result.ok, true);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(
    serialized,
    /\/Users\/|\/home\/|npm run|sk-123456789|C:\\\\private/,
  );
});

test("cancelled requests do not invoke the model", async () => {
  const controller = new AbortController();
  controller.abort();
  let invoked = false;
  const app = createDistillationApplication({
    sessions: createSessionQueryService({ list: async () => [session("s1")] }),
    ai: {
      execute: async () => {
        invoked = true;
        return execution();
      },
    },
  });
  const result = await app.start(
    request({
      signal: controller.signal,
      selection: { sessionRefs: [{ source: "codex", sessionId: "s1" }] },
    }),
  );
  assert.equal(result.ok, false);
  assert.equal(invoked, false);
});
