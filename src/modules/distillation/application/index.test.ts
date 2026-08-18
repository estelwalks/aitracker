import assert from "node:assert/strict";
import test from "node:test";
import type { AIExecutionResult } from "../../ai-orchestration/contracts.ts";
import type {
  KnowledgeAsset,
  KnowledgeAssetKind,
  KnowledgeRepository,
  KnowledgeVersion,
} from "../../knowledge/contracts.ts";
import type {
  SessionSummary,
  SessionTranscript,
} from "../../sessions/contracts.ts";
import type { CandidatePersistence } from "../contracts.ts";
import type { CandidateOutput } from "../contracts.ts";
import type { SegmentRef, SessionRef } from "../contracts.ts";
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
  persistence?: CandidatePersistence,
  transcriptPort?: {
    load(ref: SessionRef): Promise<SessionTranscript | null>;
  },
  knowledgeAssets: readonly KnowledgeAsset[] = [],
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
    async list() {
      return { ok: true, value: knowledgeAssets } as const;
    },
  } as unknown as KnowledgeRepository;
  const app = createDistillationApplication({
    sessions: createSessionQueryService({ list: async () => rows }),
    ai: { execute: async () => aiResult },
    knowledge,
    persistence,
    ...(transcriptPort ? { transcriptPort } : {}),
    createCandidateId: () => "candidate-1",
    now: () => new Date("2026-08-07T00:02:00.000Z"),
  });
  return { app, calls };
}

/** In-memory SessionTranscript double for user-selected segment reads. */
const transcript = (
  sessionId: string,
  messages: readonly { role: "user" | "assistant"; text: string }[],
): SessionTranscript => ({
  sessionId,
  source: "codex",
  messages: [...messages],
});

/** In-memory CandidatePersistence double that captures writes and supports re-hydration. */
function fakePersistence(initial: CandidateOutput[] = []) {
  const map = new Map(initial.map((item) => [item.candidateId, item]));
  return {
    port: {
      async list(): Promise<readonly CandidateOutput[]> {
        return [...map.values()].sort((a, b) =>
          b.generatedAt.localeCompare(a.generatedAt),
        );
      },
      async save(candidate: CandidateOutput): Promise<void> {
        map.set(candidate.candidateId, candidate);
      },
    },
    snapshot: () => [...map.values()],
  };
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

test("start persists the candidate so a fresh application can list it via listWaiting", async () => {
  const persistence = fakePersistence();
  const { app } = setup(
    execution(),
    [session("s1"), session("s2")],
    persistence.port,
  );
  const started = await app.start(request());
  assert.equal(started.ok, true);

  const fresh = createDistillationApplication({
    sessions: createSessionQueryService({ list: async () => [] }),
    ai: { execute: async () => execution() },
    persistence: persistence.port,
  });
  const waiting = await fresh.listWaiting();
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0]!.candidateId, "candidate-1");
  assert.equal(waiting[0]!.approvalState, "waiting-approval");
  assert.equal(waiting[0]!.title, "Distilled summary (2 sessions)");
});

test("approve persists the updated state and removes the candidate from listWaiting", async () => {
  const persistence = fakePersistence();
  const { app } = setup(
    execution(),
    [session("s1"), session("s2")],
    persistence.port,
  );
  const started = await app.start(request());
  const candidateId = started.ok ? started.value.candidate!.candidateId : "";
  const approved = await app.approve(candidateId, "user");
  assert.equal(approved.ok, true);

  const fresh = createDistillationApplication({
    sessions: createSessionQueryService({ list: async () => [] }),
    ai: { execute: async () => execution() },
    persistence: persistence.port,
  });
  assert.equal((await fresh.listWaiting()).length, 0);
  const all = await fresh.listAll();
  assert.equal(all.length, 1);
  assert.equal(all[0]!.approvalState, "approved");
  assert.equal((await fresh.get(candidateId))?.approvalState, "approved");
});

test("cancel persists the updated state and is visible via get/listAll", async () => {
  const persistence = fakePersistence();
  const { app } = setup(
    execution(),
    [session("s1"), session("s2")],
    persistence.port,
  );
  const started = await app.start(request());
  const candidateId = started.ok ? started.value.candidate!.candidateId : "";
  const cancelled = await app.cancel(candidateId);
  assert.equal(cancelled.ok, true);

  const fresh = createDistillationApplication({
    sessions: createSessionQueryService({ list: async () => [] }),
    ai: { execute: async () => execution() },
    persistence: persistence.port,
  });
  assert.equal((await fresh.listWaiting()).length, 0);
  assert.equal((await fresh.get(candidateId))?.approvalState, "cancelled");
  assert.equal((await fresh.listAll())[0]!.approvalState, "cancelled");
});

test("a store seeded on disk is hydrated into the map before any list call", async () => {
  const seeded = await setup().app.start(request());
  assert.equal(seeded.ok, true);
  const candidate = seeded.ok ? seeded.value.candidate! : undefined;
  const persistence = fakePersistence(candidate ? [candidate] : []);
  const app = createDistillationApplication({
    sessions: createSessionQueryService({ list: async () => [] }),
    ai: { execute: async () => execution() },
    persistence: persistence.port,
  });
  assert.equal((await app.listWaiting())[0]!.candidateId, "candidate-1");
});

test("approve/cancel on a missing or non-waiting candidate never writes through", async () => {
  const persistence = fakePersistence();
  const { app } = setup(
    execution(),
    [session("s1"), session("s2")],
    persistence.port,
  );
  assert.equal((await app.approve("unknown", "user")).ok, false);
  assert.equal((await app.cancel("unknown")).ok, false);
  assert.equal(persistence.snapshot().length, 0);
});

test("user-selected segments append segment text to the AI input and never persist it", async () => {
  let input = "";
  const persistence = fakePersistence();
  const loadTranscript = async (
    ref: SessionRef,
  ): Promise<SessionTranscript | null> =>
    ref.sessionId === "s1"
      ? transcript("s1", [
          { role: "user", text: "please fix the parser bug" },
          { role: "assistant", text: "fixed the parser loop" },
          { role: "user", text: "add a test for empty input" },
        ])
      : null;
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
    persistence: persistence.port,
    transcriptPort: { load: loadTranscript },
  });
  const result = await app.start(
    request({
      selection: {
        sessionRefs: [
          { source: "codex", sessionId: "s1" },
          { source: "codex", sessionId: "s2" },
        ],
        segments: [
          { source: "codex", sessionId: "s1", startIndex: 1, endIndex: 2 },
        ],
      },
    }),
  );
  assert.equal(result.ok, true);
  assert.match(input, /--- 用户选择片段 ---/);
  assert.match(input, /fixed the parser loop/);
  assert.match(input, /add a test for empty input/);
  // The inclusive window [1..2] must exclude message 0.
  assert.doesNotMatch(input, /please fix the parser bug/);
  // The raw segment text must never reach the persisted candidate: the
  // candidate carries only the AI-generated summary, not the input.
  const persisted = JSON.stringify(persistence.snapshot());
  assert.doesNotMatch(persisted, /parser bug|parser loop|empty input/);
});

test("a failing or missing segment read degrades to metadata-only distillation", async () => {
  const build = (transcriptPort: {
    load(ref: SessionRef): Promise<SessionTranscript | null>;
  }) => {
    let input = "";
    const app = createDistillationApplication({
      sessions: createSessionQueryService({
        list: async () => [session("s1")],
      }),
      ai: {
        execute: async (req) => {
          input = req.input.text;
          return execution();
        },
      },
      transcriptPort,
    });
    return { app, input: () => input };
  };

  // Reader throws → segment dropped, metadata distillation still succeeds.
  const failing = build({
    load: async (): Promise<SessionTranscript | null> => {
      throw new Error("reader exploded");
    },
  });
  const failedResult = await failing.app.start(
    request({
      selection: {
        sessionRefs: [{ source: "codex", sessionId: "s1" }],
        segments: [
          { source: "codex", sessionId: "s1", startIndex: 0, endIndex: 2 },
        ],
      },
    }),
  );
  assert.equal(failedResult.ok, true);
  assert.doesNotMatch(failing.input(), /--- 用户选择片段 ---/);
  assert.match(failing.input(), /Session 1: codex:s1/);

  // Null transcript (session not found / unsupported source) degrades too.
  const missing = build({
    load: async (): Promise<SessionTranscript | null> => null,
  });
  const missingResult = await missing.app.start(
    request({
      selection: {
        sessionRefs: [{ source: "codex", sessionId: "s1" }],
        segments: [
          { source: "codex", sessionId: "s1", startIndex: 0, endIndex: 2 },
        ],
      },
    }),
  );
  assert.equal(missingResult.ok, true);
  assert.doesNotMatch(missing.input(), /--- 用户选择片段 ---/);
  assert.match(missing.input(), /Session 1: codex:s1/);
});

test("out-of-range segment windows clamp to the available messages", async () => {
  let input = "";
  const app = createDistillationApplication({
    sessions: createSessionQueryService({
      list: async () => [session("s1")],
    }),
    ai: {
      execute: async (req) => {
        input = req.input.text;
        return execution();
      },
    },
    transcriptPort: {
      load: async (): Promise<SessionTranscript | null> =>
        transcript("s1", [
          { role: "user", text: "message zero" },
          { role: "assistant", text: "message one" },
        ]),
    },
  });
  const result = await app.start(
    request({
      selection: {
        sessionRefs: [{ source: "codex", sessionId: "s1" }],
        segments: [
          { source: "codex", sessionId: "s1", startIndex: 0, endIndex: 99 },
        ],
      },
    }),
  );
  assert.equal(result.ok, true);
  assert.match(input, /--- 用户选择片段 ---/);
  assert.match(input, /message zero/);
  assert.match(input, /message one/);
});

test("invalid segments are rejected before the model runs", async () => {
  let invoked = false;
  const app = createDistillationApplication({
    sessions: createSessionQueryService({
      list: async () => [session("s1"), session("s2")],
    }),
    ai: {
      execute: async () => {
        invoked = true;
        return execution();
      },
    },
  });
  const malformed = [
    // Negative window bound.
    { source: "codex", sessionId: "s1", startIndex: -1, endIndex: 2 },
    // Inverted window (start > end).
    { source: "codex", sessionId: "s1", startIndex: 3, endIndex: 1 },
    // Non-integer bound.
    { source: "codex", sessionId: "s1", startIndex: 1.5, endIndex: 2 },
    // Non-opaque source.
    { source: "../codex", sessionId: "s1", startIndex: 0, endIndex: 1 },
  ] as SegmentRef[];
  for (const segment of malformed) {
    const result = await app.start(
      request({
        selection: {
          sessionRefs: [{ source: "codex", sessionId: "s1" }],
          segments: [segment],
        },
      }),
    );
    assert.equal(result.ok, false);
  }
  // A segment pointing outside the selection is rejected too.
  const unselected = await app.start(
    request({
      selection: {
        sessionRefs: [{ source: "codex", sessionId: "s1" }],
        segments: [
          { source: "codex", sessionId: "s2", startIndex: 0, endIndex: 1 },
        ],
      },
    }),
  );
  assert.equal(unselected.ok, false);
  // Duplicate windows are rejected.
  const duplicate = await app.start(
    request({
      selection: {
        sessionRefs: [{ source: "codex", sessionId: "s1" }],
        segments: [
          { source: "codex", sessionId: "s1", startIndex: 0, endIndex: 1 },
          { source: "codex", sessionId: "s1", startIndex: 0, endIndex: 1 },
        ],
      },
    }),
  );
  assert.equal(duplicate.ok, false);
  // More than 8 segments are rejected.
  const tooMany = Array.from({ length: 9 }, (_, index) => ({
    source: "codex",
    sessionId: "s1",
    startIndex: index,
    endIndex: index,
  }));
  const overLimit = await app.start(
    request({
      selection: {
        sessionRefs: [{ source: "codex", sessionId: "s1" }],
        segments: tooMany,
      },
    }),
  );
  assert.equal(overLimit.ok, false);
  assert.equal(invoked, false);
});

test("counts() buckets distilled knowledge assets into capability and memory", async () => {
  const asset = (
    kind: KnowledgeAssetKind,
    assetId: string,
  ): KnowledgeAsset => ({
    assetId,
    kind,
    title: assetId,
    currentVersion: 1,
    status: "approved",
    createdAt: "2026-08-07T00:00:00.000Z",
    updatedAt: "2026-08-07T00:00:00.000Z",
  });
  const { app } = setup(execution(), [], undefined, undefined, [
    asset("snippet", "a1"), // skill/prompt/persona 蒸馏产物 → 能力资产
    asset("brief", "a2"), // workflow 蒸馏产物 → 能力资产
    asset("memory", "a3"), // task 蒸馏产物 → 记忆资产
  ]);
  assert.deepEqual(await app.counts(), { capability: 2, memory: 1 });
  assert.equal(await app.count(), 3);
});
