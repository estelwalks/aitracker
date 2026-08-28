import assert from "node:assert/strict";
import test from "node:test";

import type { AIExecutorPort } from "../../ai-orchestration/ai-executor.ts";
import type {
  AIExecutionResult,
  AIExecutionStatus,
  AIRequest,
} from "../../ai-orchestration/contracts.ts";
import type {
  InsightCacheIdentity,
  InsightEnhancementCache,
  InsightGenerationReservation,
  InsightMode,
  InsightPreference,
  SqliteInsightRepository,
} from "../infrastructure/sqlite-insight-repository.server.ts";
import {
  createInsightEnhancer,
  INSIGHT_ENHANCEMENT_CACHE_TTL_MS,
  type InsightEnhancerInput,
  type InsightEnhancerOptions,
  type InsightExecutionRecord,
} from "./application.ts";

const FIXED_NOW = 1_700_000_000_000;

function keyFor(identity: InsightCacheIdentity): string {
  return JSON.stringify([
    identity.surfaceId,
    identity.scopeHash,
    identity.evidenceHash,
    identity.locale,
    identity.profileId,
    identity.promptVersionId,
    identity.promptVersion,
  ]);
}

class FakeInsightRepository implements SqliteInsightRepository {
  readonly saved: InsightEnhancementCache[] = [];
  private readonly entries = new Map<string, InsightEnhancementCache>();
  private readonly reservations = new Map<
    string,
    InsightGenerationReservation
  >();
  private activeRefreshRun = false;

  getPreference(): InsightPreference | undefined {
    return undefined;
  }

  getEffectivePreference(): InsightPreference {
    return {
      scopeKey: "global",
      mode: "rules",
      profileId: null,
      consentVersion: null,
      consentedAtMs: null,
      dailyCallLimit: null,
      updatedAtMs: 0,
    };
  }

  getRefreshIntervalMs(): number {
    return 60 * 60 * 1000;
  }

  setRefreshIntervalMs(): void {
    // not used by the enhancer
  }

  setPreference(): void {
    // not used by the enhancer
  }

  getRefreshGeneration(): number {
    return 1;
  }

  getRefreshGenerationStartedAtMs(): number {
    return FIXED_NOW;
  }

  hasActiveRefreshRun(): boolean {
    return this.activeRefreshRun;
  }

  setActiveRefreshRun(active: boolean): void {
    this.activeRefreshRun = active;
  }

  claimGeneration(
    value: Omit<
      InsightGenerationReservation,
      "status" | "resultStatus" | "finishedAtMs"
    >,
  ) {
    const existing = this.reservations.get(value.reservationKey);
    // Mirrors the repository: only running/completed reservations stay
    // exclusive; a failed reservation can be re-claimed and retried.
    if (existing && existing.status !== "failed") {
      return { claimed: false, reservation: existing };
    }
    const reservation: InsightGenerationReservation = {
      ...value,
      status: "running",
      resultStatus: null,
      finishedAtMs: null,
    };
    this.reservations.set(value.reservationKey, reservation);
    return { claimed: true, reservation };
  }

  finishGeneration(input: {
    readonly reservationKey: string;
    readonly ownerId: string;
    readonly status: "completed" | "failed";
    readonly resultStatus: string;
    readonly nowMs: number;
  }): boolean {
    const existing = this.reservations.get(input.reservationKey);
    if (!existing || existing.ownerId !== input.ownerId) return false;
    this.reservations.set(input.reservationKey, {
      ...existing,
      status: input.status,
      resultStatus: input.resultStatus,
      finishedAtMs: input.nowMs,
    });
    return true;
  }

  clearReservations(): void {
    this.reservations.clear();
  }

  findValid(
    identity: InsightCacheIdentity,
    nowMs: number,
  ): InsightEnhancementCache | undefined {
    const entry = this.entries.get(keyFor(identity));
    if (!entry) return undefined;
    return entry.expiresAtMs > nowMs ? entry : undefined;
  }

  findLatestValid(
    identity: InsightCacheIdentity,
    nowMs: number,
  ): InsightEnhancementCache | undefined {
    return [...this.entries.values()]
      .filter(
        (entry) =>
          entry.surfaceId === identity.surfaceId &&
          entry.scopeHash === identity.scopeHash &&
          entry.locale === identity.locale &&
          entry.profileId === identity.profileId &&
          entry.promptVersionId === identity.promptVersionId &&
          entry.promptVersion === identity.promptVersion &&
          entry.expiresAtMs > nowMs,
      )
      .sort((left, right) => right.generatedAtMs - left.generatedAtMs)[0];
  }

  saveEnhancement(input: {
    readonly mode: InsightMode;
    readonly value: InsightEnhancementCache;
    readonly forbiddenEntities?: readonly string[];
  }): boolean {
    if (input.mode === "rules") return false;
    this.saved.push(input.value);
    this.entries.set(keyFor(input.value), input.value);
    return true;
  }

  seed(value: InsightEnhancementCache): void {
    this.entries.set(keyFor(value), value);
  }

  invalidate(cacheKey: string): boolean {
    return this.entries.delete(cacheKey);
  }

  pruneExpired(nowMs: number): number {
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (entry.expiresAtMs <= nowMs) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}

function fakeAI(
  program: () => AIExecutionResult | Promise<AIExecutionResult>,
): {
  ai: AIExecutorPort;
  calls: () => number;
  requests: () => readonly AIRequest[];
} {
  let count = 0;
  const captured: AIRequest[] = [];
  const ai: AIExecutorPort = {
    async execute(request) {
      count += 1;
      captured.push(request);
      return program();
    },
  };
  return { ai, calls: () => count, requests: () => captured };
}

function completedResult(text: string): AIExecutionResult {
  return {
    summary: {
      requestId: "req-1",
      modelId: "p1",
      providerId: "profile",
      promptVersionId: "insight.dashboard",
      promptVersion: 1,
      status: "completed",
      cost: { confidence: "unknown", currency: "USD", reason: "no-pricing" },
      usedFallback: false,
    },
    response: {
      modelId: "p1",
      providerId: "profile",
      text,
      finishReason: "stop",
    },
  };
}

function statusResult(status: AIExecutionStatus): AIExecutionResult {
  return {
    summary: {
      requestId: "req-1",
      modelId: "p1",
      providerId: "profile",
      promptVersionId: "insight.dashboard",
      promptVersion: 1,
      status,
      cost: {
        confidence: "unknown",
        currency: "USD",
        reason: status === "offline" ? "offline" : "no-pricing",
      },
      usedFallback: status !== "completed",
    },
    response: {
      modelId: "p1",
      providerId: "profile",
      text: "Offline deterministic fallback",
      finishReason: "stop",
    },
  };
}

function input(
  overrides: Partial<InsightEnhancerInput> = {},
): InsightEnhancerInput {
  return {
    surface: "dashboard",
    adapterVersion: 1,
    locale: "zh-CN",
    candidates: [
      {
        id: "c1",
        severity: "risk",
        fact: "检测到安全风险",
        actionIds: ["open_security"],
        mandatory: true,
      },
      {
        id: "c2",
        severity: "info",
        fact: "今日使用量正常",
        actionIds: ["open_tracker"],
        mandatory: false,
      },
    ],
    ...overrides,
  };
}

const VALID_OUTPUT = JSON.stringify({
  lines: [
    {
      candidateId: "c1",
      analysis: "请优先处理安全告警",
      actionId: "open_security",
    },
    { candidateId: "c2", analysis: "使用趋势保持平稳" },
  ],
});

const profile = { id: "p1", label: "Model" };
const resolveProfile = () => Promise.resolve(profile);

type EnhancerOverrides = Pick<
  InsightEnhancerOptions,
  | "ttlMs"
  | "dailyCallLimit"
  | "singleflight"
  | "recordExecution"
  | "maxAttempts"
  | "retryDelayMs"
>;

function enhancer(
  ai: AIExecutorPort,
  repository: FakeInsightRepository,
  overrides: EnhancerOverrides = {},
) {
  return createInsightEnhancer({
    ai,
    repository,
    resolveActiveProfile: resolveProfile,
    now: () => FIXED_NOW,
    ...overrides,
  });
}

test("no active profile returns enhancer-unavailable without calling the model", async () => {
  const { ai, calls } = fakeAI(() => completedResult(VALID_OUTPUT));
  const target = createInsightEnhancer({
    ai,
    repository: new FakeInsightRepository(),
    resolveActiveProfile: () => Promise.resolve(null),
    now: () => FIXED_NOW,
  });
  const result = await target.enhance(input());
  assert.equal(result.status, "enhancer-unavailable");
  assert.deepEqual(result.lines, []);
  assert.equal(calls(), 0);
});

test("successful generation writes the cache and a second call hits it", async () => {
  const { ai, calls, requests } = fakeAI(() => completedResult(VALID_OUTPUT));
  const repository = new FakeInsightRepository();
  const target = enhancer(ai, repository);

  const first = await target.enhance(input());
  assert.equal(first.status, "enhanced-ready");
  assert.equal(first.lines.length, 2);
  assert.equal(first.modelLabel, "Model");
  assert.equal(calls(), 1);
  assert.equal(repository.saved.length, 1);

  const second = await target.enhance(input());
  assert.equal(second.status, "enhanced-cached");
  assert.equal(second.modelLabel, "Model");
  assert.equal(second.lines.length, 2);
  assert.equal(calls(), 1, "cache hit must not invoke the model again");
  // Calibrated for reasoning models: 120s timeout and a 32K output budget
  // (the old 90s/8192 pair cut deep-reasoning runs mid-thought).
  assert.equal(requests()[0]?.timeoutMs, 120_000);
  assert.equal(requests()[0]?.maxOutputTokens, 32_768);
});

test("a changed evidence sample reuses AI text until the configured TTL expires", async () => {
  const { ai, calls } = fakeAI(() => completedResult(VALID_OUTPUT));
  const target = enhancer(ai, new FakeInsightRepository());

  assert.equal((await target.enhance(input())).status, "enhanced-ready");
  const changedCandidates = input().candidates.map((candidate) => ({
    ...candidate,
    fact: `${candidate.fact}，新的规则事实`,
  }));
  const cached = await target.enhance(input({ candidates: changedCandidates }));

  assert.equal(cached.status, "enhanced-cached");
  assert.equal(calls(), 1);
});

test("dotted page candidate ids do not trip outbound URL validation", async () => {
  const { ai } = fakeAI(() =>
    completedResult(
      JSON.stringify({
        lines: [
          {
            candidateId: "tracker.top-model",
            analysis: "该维度可用于聚焦当前消耗结构",
          },
        ],
      }),
    ),
  );
  const repository = new FakeInsightRepository();
  const target = enhancer(ai, repository);

  const result = await target.enhance(
    input({
      surface: "tracker",
      candidates: [
        {
          id: "tracker.top-model",
          severity: "info",
          fact: "当前使用的模型已汇总",
          actionIds: ["open_tracker"],
          mandatory: false,
        },
      ],
    }),
  );

  assert.equal(result.status, "enhanced-ready");
  assert.equal(repository.saved.length, 1);
});

test("readCached returns persisted AI lines without invoking the model", async () => {
  const { ai, calls } = fakeAI(() => completedResult(VALID_OUTPUT));
  const repository = new FakeInsightRepository();
  const target = enhancer(ai, repository);

  await target.enhance(input());
  const cached = await target.readCached?.(input());
  assert.equal(cached?.status, "enhanced-cached");
  assert.equal(cached?.lines.length, 2);
  assert.equal(calls(), 1);
});

test("default cache expires after one hour", async () => {
  let nowMs = FIXED_NOW;
  const { ai, calls } = fakeAI(() => completedResult(VALID_OUTPUT));
  const repository = new FakeInsightRepository();
  const target = createInsightEnhancer({
    ai,
    repository,
    resolveActiveProfile: resolveProfile,
    now: () => nowMs,
  });

  assert.equal(INSIGHT_ENHANCEMENT_CACHE_TTL_MS, 60 * 60 * 1000);
  assert.equal((await target.enhance(input())).status, "enhanced-ready");
  assert.equal(
    repository.saved[0]!.expiresAtMs - repository.saved[0]!.generatedAtMs,
    INSIGHT_ENHANCEMENT_CACHE_TTL_MS,
  );

  nowMs += INSIGHT_ENHANCEMENT_CACHE_TTL_MS - 1;
  assert.equal((await target.enhance(input())).status, "enhanced-cached");
  assert.equal(calls(), 1);

  nowMs += 1;
  assert.equal((await target.enhance(input())).status, "enhanced-ready");
  assert.equal(calls(), 2);
});

test("legacy cache entries older than one hour are refreshed", async () => {
  const nowMs = FIXED_NOW;
  const { ai, calls } = fakeAI(() => completedResult(VALID_OUTPUT));
  const repository = new FakeInsightRepository();
  const target = createInsightEnhancer({
    ai,
    repository,
    resolveActiveProfile: resolveProfile,
    now: () => nowMs,
  });

  assert.equal((await target.enhance(input())).status, "enhanced-ready");
  const saved = repository.saved[0]!;
  repository.seed({
    ...saved,
    generatedAtMs: FIXED_NOW - 2 * 60 * 60 * 1000,
    expiresAtMs: FIXED_NOW + 2 * 60 * 60 * 1000,
  });
  repository.clearReservations();

  assert.equal((await target.enhance(input())).status, "enhanced-ready");
  assert.equal(calls(), 2);
});

test("default daily budget allows the 500th call and rejects the 501st", async () => {
  const { ai, calls } = fakeAI(() => completedResult(VALID_OUTPUT));
  const target = enhancer(ai, new FakeInsightRepository());

  for (let adapterVersion = 1; adapterVersion <= 500; adapterVersion += 1) {
    assert.equal(
      (await target.enhance(input({ adapterVersion }))).status,
      "enhanced-ready",
    );
  }
  assert.equal(
    (await target.enhance(input({ adapterVersion: 501 }))).status,
    "budget-exceeded",
  );
  assert.equal(calls(), 500);
});

test("adapterVersion isolates the enhancement cache identity", async () => {
  const { ai, calls } = fakeAI(() => completedResult(VALID_OUTPUT));
  const repository = new FakeInsightRepository();
  const target = enhancer(ai, repository);

  assert.equal(
    (await target.enhance(input({ adapterVersion: 3 }))).status,
    "enhanced-ready",
  );
  assert.equal(
    (await target.enhance(input({ adapterVersion: 4 }))).status,
    "enhanced-ready",
  );
  assert.equal(calls(), 2);
  assert.equal(repository.saved.length, 2);
  assert.notEqual(
    repository.saved[0]?.scopeHash,
    repository.saved[1]?.scopeHash,
  );
});

test("timeout returns timeout with no lines", async () => {
  const { ai, calls } = fakeAI(() => statusResult("timeout"));
  const target = enhancer(ai, new FakeInsightRepository(), {
    maxAttempts: 1,
  });
  const result = await target.enhance(input());
  assert.equal(result.status, "timeout");
  assert.deepEqual(result.lines, []);
  assert.equal(calls(), 1);
});

test("transient failures are retried until the attempt budget is spent", async () => {
  const { ai, calls } = fakeAI(() => statusResult("timeout"));
  const target = enhancer(ai, new FakeInsightRepository(), {
    maxAttempts: 3,
    retryDelayMs: () => 0,
  });
  const result = await target.enhance(input());
  assert.equal(result.status, "timeout");
  assert.equal(calls(), 3, "three attempts for a persistently failing model");
});

test("a transient failure succeeds on retry", async () => {
  let attempts = 0;
  const { ai, calls } = fakeAI(() => {
    attempts += 1;
    return attempts === 1
      ? statusResult("timeout")
      : completedResult(VALID_OUTPUT);
  });
  const target = enhancer(ai, new FakeInsightRepository(), {
    maxAttempts: 3,
    retryDelayMs: () => 0,
  });
  const result = await target.enhance(input());
  assert.equal(result.status, "enhanced-ready");
  assert.equal(calls(), 2);
});

test("budget exhaustion is never retried", async () => {
  let attempts = 0;
  const { ai, calls } = fakeAI(() => {
    attempts += 1;
    return statusResult("budget-exceeded");
  });
  const target = enhancer(ai, new FakeInsightRepository(), {
    maxAttempts: 3,
    retryDelayMs: () => 0,
  });
  const result = await target.enhance(input());
  assert.equal(result.status, "budget-exceeded");
  assert.equal(calls(), 1);
});

test("offline returns enhancer-failed with no lines", async () => {
  const { ai } = fakeAI(() => statusResult("offline"));
  const target = enhancer(ai, new FakeInsightRepository());
  const result = await target.enhance(input());
  assert.equal(result.status, "enhancer-failed");
  assert.deepEqual(result.lines, []);
});

test("budget exceeded blocks the model call", async () => {
  const { ai, calls } = fakeAI(() => completedResult(VALID_OUTPUT));
  const target = enhancer(ai, new FakeInsightRepository(), {
    dailyCallLimit: 0,
  });
  const result = await target.enhance(input());
  assert.equal(result.status, "budget-exceeded");
  assert.deepEqual(result.lines, []);
  assert.equal(calls(), 0);
});

test("effective preference daily limit overrides the enhancer default", async () => {
  const { ai, calls } = fakeAI(() => completedResult(VALID_OUTPUT));
  const target = enhancer(ai, new FakeInsightRepository(), {
    dailyCallLimit: 30,
  });
  const result = await target.enhance(input({ dailyCallLimit: 0 }));
  assert.equal(result.status, "budget-exceeded");
  assert.equal(calls(), 0);
});

test("effective preference profile is resolved instead of the active profile", async () => {
  const { ai, requests } = fakeAI(() => completedResult(VALID_OUTPUT));
  const target = createInsightEnhancer({
    ai,
    repository: new FakeInsightRepository(),
    resolveActiveProfile: () =>
      Promise.resolve({ id: "active", label: "Active" }),
    resolveProfile: async (id) =>
      id === "selected" ? { id, label: "Selected" } : null,
    now: () => FIXED_NOW,
  });
  const result = await target.enhance(input({ profileId: "selected" }));
  assert.equal(result.status, "enhanced-ready");
  assert.equal(requests()[0]?.modelId, "selected");
  assert.equal(result.modelLabel, "Selected");
});

test("unknown effective preference profile makes no model call", async () => {
  const { ai, calls } = fakeAI(() => completedResult(VALID_OUTPUT));
  const target = createInsightEnhancer({
    ai,
    repository: new FakeInsightRepository(),
    resolveActiveProfile: resolveProfile,
    resolveProfile: async () => null,
    now: () => FIXED_NOW,
  });
  const result = await target.enhance(input({ profileId: "missing" }));
  assert.equal(result.status, "enhancer-unavailable");
  assert.equal(calls(), 0);
});

test("a missing mandatory candidate is invalid-output and is not cached", async () => {
  const missingMandatory = JSON.stringify({
    lines: [{ candidateId: "c2", analysis: "使用趋势保持平稳" }],
  });
  const { ai } = fakeAI(() => completedResult(missingMandatory));
  const repository = new FakeInsightRepository();
  const target = enhancer(ai, repository, { maxAttempts: 1 });
  const result = await target.enhance(input());
  assert.equal(result.status, "invalid-output");
  assert.equal(repository.saved.length, 0);
});

test("an output containing digits is invalid-output", async () => {
  const withDigit = JSON.stringify({
    lines: [{ candidateId: "c1", analysis: "检测到 42 个风险" }],
  });
  const { ai } = fakeAI(() => completedResult(withDigit));
  const target = enhancer(ai, new FakeInsightRepository(), {
    maxAttempts: 1,
  });
  const result = await target.enhance(input());
  assert.equal(result.status, "invalid-output");
});

test("failure attribution is returned with the final failed result", async () => {
  const { ai } = fakeAI(() => ({
    summary: {
      requestId: "req-1",
      modelId: "p1",
      providerId: "profile",
      promptVersionId: "insight.dashboard",
      promptVersion: 1,
      status: "fallback",
      cost: { confidence: "unknown", currency: "USD", reason: "no-pricing" },
      usedFallback: true,
      errorCode: "ai.provider-invalid-response",
      failureDetail: "reasoning-only",
    },
    response: {
      modelId: "p1",
      providerId: "profile",
      text: "Offline deterministic fallback",
      finishReason: "stop",
    },
  }));
  const target = enhancer(ai, new FakeInsightRepository(), {
    maxAttempts: 1,
  });
  const result = await target.enhance(input());
  assert.equal(result.status, "enhancer-failed");
  assert.equal(result.failureDetail, "reasoning-only");
});

test("a save failure is reported instead of pretending persistence", async () => {
  const { ai } = fakeAI(() => completedResult(VALID_OUTPUT));
  const repository = new FakeInsightRepository();
  const original = repository.saveEnhancement.bind(repository);
  repository.saveEnhancement = () => {
    throw new Error("privacy guard rejected the line");
  };
  const target = enhancer(ai, repository, { maxAttempts: 1 });
  const result = await target.enhance(input());
  assert.equal(result.status, "enhanced-ready");
  assert.equal(result.persisted, false);
  assert.equal(repository.saved.length, 0);
  repository.saveEnhancement = original;
});

test("a sensitive fact never reaches the model", async () => {
  const { ai, calls } = fakeAI(() => completedResult(VALID_OUTPUT));
  const target = enhancer(ai, new FakeInsightRepository());
  const result = await target.enhance(
    input({
      candidates: [
        {
          id: "c1",
          severity: "risk",
          fact: "密钥是 sk-abcdefghijklmnopqrstuvwxyz123456",
          actionIds: ["open_security"],
          mandatory: true,
        },
      ],
    }),
  );
  assert.equal(result.status, "enhancer-failed");
  assert.equal(calls(), 0);
});

test("singleflight merges concurrent same-scope calls", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const { ai, calls } = fakeAI(async () => {
    await gate;
    return completedResult(VALID_OUTPUT);
  });
  const target = enhancer(ai, new FakeInsightRepository());

  const first = target.enhance(input());
  const second = target.enhance(input());
  release();
  const [r1, r2] = await Promise.all([first, second]);

  assert.equal(calls(), 1);
  assert.deepEqual(r1, r2);
  assert.equal(r1.status, "enhanced-ready");
});

test("persistent reservation merges the same call across enhancer instances", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { ai, calls } = fakeAI(async () => {
    await gate;
    return completedResult(VALID_OUTPUT);
  });
  const repository = new FakeInsightRepository();
  const firstEnhancer = enhancer(ai, repository);
  const secondEnhancer = enhancer(ai, repository);

  const first = firstEnhancer.enhance(input());
  const duplicate = secondEnhancer.enhance(input());
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls(), 1);
  release();
  const results = await Promise.all([first, duplicate]);
  assert.equal(calls(), 1);
  assert.ok(results.some((result) => result.status === "enhanced-ready"));
});

test("a failed reservation is re-claimed and retried after the cooldown", async () => {
  const { ai, calls } = fakeAI(() => statusResult("fallback"));
  const repository = new FakeInsightRepository();
  let nowMs = FIXED_NOW;
  const target = createInsightEnhancer({
    ai,
    repository,
    resolveActiveProfile: resolveProfile,
    now: () => nowMs,
    maxAttempts: 1, // this test covers reservation re-claim, not retries
  });

  assert.equal((await target.enhance(input())).status, "enhancer-failed");
  assert.equal(calls(), 1);
  nowMs += 61_000;
  assert.equal((await target.enhance(input())).status, "enhancer-failed");
  assert.equal(calls(), 2, "a failed reservation must not block a retry");
});

test("an active refresh run keeps one reservation across TTL boundaries", async () => {
  const { ai, calls } = fakeAI(() => completedResult(VALID_OUTPUT));
  const repository = new FakeInsightRepository();
  repository.setActiveRefreshRun(true);
  let nowMs = FIXED_NOW;
  const target = createInsightEnhancer({
    ai,
    repository,
    resolveActiveProfile: resolveProfile,
    now: () => nowMs,
  });

  // Renderer calls are no longer hard-blocked during a batch; ownership is
  // coordinated by the generation reservation instead.
  assert.equal((await target.enhance(input())).status, "enhanced-ready");
  assert.equal(calls(), 1);
  assert.equal(
    (await target.enhance(input({ batchOwned: true }))).status,
    "enhanced-cached",
    "the duplicate identity is served from the persisted cache",
  );
  assert.equal(calls(), 1);
  nowMs += 2 * INSIGHT_ENHANCEMENT_CACHE_TTL_MS;
  assert.equal(
    (await target.enhance(input({ batchOwned: true }))).status,
    "enhancer-failed",
  );
  assert.equal(calls(), 1, "the completed reservation still blocks re-claims");
});

test("bounds concurrent surfaces through the shared pool", async () => {
  let active = 0;
  let maxActive = 0;
  const { ai } = fakeAI(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return completedResult(VALID_OUTPUT);
  });
  const target = enhancer(ai, new FakeInsightRepository());

  const [first, second] = await Promise.all([
    target.enhance(input()),
    target.enhance(input({ surface: "agents" })),
  ]);

  assert.equal(first.status, "enhanced-ready");
  assert.equal(second.status, "enhanced-ready");
  assert.equal(maxActive, 2, "different surfaces share the bounded pool");

  // A burst-sensitive provider can still request full serialization.
  let serialActive = 0;
  let serialMax = 0;
  const serial = fakeAI(async () => {
    serialActive += 1;
    serialMax = Math.max(serialMax, serialActive);
    await new Promise((resolve) => setTimeout(resolve, 5));
    serialActive -= 1;
    return completedResult(VALID_OUTPUT);
  });
  const serialTarget = createInsightEnhancer({
    ai: serial.ai,
    repository: new FakeInsightRepository(),
    resolveActiveProfile: resolveProfile,
    maxConcurrentRequests: 1,
  });
  await Promise.all([
    serialTarget.enhance(input()),
    serialTarget.enhance(input({ surface: "agents" })),
  ]);
  assert.equal(
    serialMax,
    1,
    "maxConcurrentRequests: 1 restores serial behavior",
  );
});

test("recordExecution receives the execution summary on success", async () => {
  const { ai } = fakeAI(() => completedResult(VALID_OUTPUT));
  let record: InsightExecutionRecord | undefined;
  const target = enhancer(ai, new FakeInsightRepository(), {
    recordExecution: (value) => {
      record = value;
    },
  });
  await target.enhance(input());
  assert.equal(record?.capability, "page-insight");
  assert.equal(record?.surfaceId, "dashboard");
  assert.equal(record?.profileId, "p1");
  assert.equal(record?.summary.status, "completed");
});
