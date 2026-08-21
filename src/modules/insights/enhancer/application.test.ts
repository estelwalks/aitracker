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

  setPreference(): void {
    // not used by the enhancer
  }

  findValid(
    identity: InsightCacheIdentity,
    nowMs: number,
  ): InsightEnhancementCache | undefined {
    const entry = this.entries.get(keyFor(identity));
    if (!entry) return undefined;
    return entry.expiresAtMs > nowMs ? entry : undefined;
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
  "ttlMs" | "dailyCallLimit" | "singleflight" | "recordExecution"
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
  assert.equal(requests()[0]?.timeoutMs, 30_000);
  assert.equal(requests()[0]?.maxOutputTokens, 8192);
});

test("default cache expires with the 30-minute page refresh cycle", async () => {
  let nowMs = FIXED_NOW;
  const { ai, calls } = fakeAI(() => completedResult(VALID_OUTPUT));
  const repository = new FakeInsightRepository();
  const target = createInsightEnhancer({
    ai,
    repository,
    resolveActiveProfile: resolveProfile,
    now: () => nowMs,
  });

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
  const target = enhancer(ai, new FakeInsightRepository());
  const result = await target.enhance(input());
  assert.equal(result.status, "timeout");
  assert.deepEqual(result.lines, []);
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
  const target = enhancer(ai, repository);
  const result = await target.enhance(input());
  assert.equal(result.status, "invalid-output");
  assert.equal(repository.saved.length, 0);
});

test("an output containing digits is invalid-output", async () => {
  const withDigit = JSON.stringify({
    lines: [{ candidateId: "c1", analysis: "检测到 42 个风险" }],
  });
  const { ai } = fakeAI(() => completedResult(withDigit));
  const target = enhancer(ai, new FakeInsightRepository());
  const result = await target.enhance(input());
  assert.equal(result.status, "invalid-output");
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
