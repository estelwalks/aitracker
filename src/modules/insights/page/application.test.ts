import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AppError } from "../../../lib/errors.ts";
import { createPageInsightsApplication } from "./application.ts";
import type {
  InsightCandidate,
  InsightEnhancementResult,
  InsightEnhancementInput,
  InsightEnhancerPort,
  InsightMode,
  InsightStorePort,
  InsightSurfaceId,
  PageInsightAdapter,
} from "./contracts.ts";

function makeAdapter(
  surfaceId: InsightSurfaceId = "dashboard",
): PageInsightAdapter {
  return {
    surfaceId,
    adapterVersion: 1,
    loadEvidence: async (scope) => ({
      surfaceId,
      scope,
      observedAt: "2026-08-07T00:00:00.000Z",
      evidence: [
        {
          id: "e1",
          kind: "metric",
          value: 5,
          observedAt: "2026-08-07T00:00:00.000Z",
          freshness: "fresh",
          sensitivity: "aggregate",
        },
      ],
    }),
    composeCandidates: (): InsightCandidate[] => [
      {
        id: "c1",
        severity: "risk",
        factKey: "insights.page.dashboard.dashboard-security-risk",
        factParams: { count: 2 },
        evidenceRefs: ["e1"],
        allowedActionIds: ["open_security"],
        actionId: "open_security",
        mandatory: true,
      },
      {
        id: "c2",
        severity: "info",
        factKey: "insights.page.dashboard.dashboard-watch",
        factParams: { agents: 3, blocked: 4, hours: 5, distillable: 6 },
        evidenceRefs: ["e1"],
        allowedActionIds: [],
      },
    ],
  };
}

function makeStore(
  mode: InsightMode = "rules",
  overrides: Partial<
    ReturnType<InsightStorePort["getEffectivePreference"]>
  > = {},
  refreshIntervalMs = 60 * 60 * 1000,
  hasActiveRefreshRun: () => boolean = () => false,
): InsightStorePort {
  return {
    getEffectivePreference: () => ({
      scopeKey: "global",
      mode,
      profileId: null,
      consentVersion: null,
      consentedAtMs: null,
      dailyCallLimit: null,
      updatedAtMs: 0,
      ...overrides,
    }),
    setPreference: () => {},
    getRefreshIntervalMs: () => refreshIntervalMs,
    setRefreshIntervalMs: () => {},
    hasActiveRefreshRun,
  };
}

function makeEnhancer(result: InsightEnhancementResult): InsightEnhancerPort {
  return {
    id: "fake-enhancer",
    enhance: async () => result,
  };
}

test("read returns the adapter's local facts when default enhancement has no enhancer", async () => {
  const app = createPageInsightsApplication({ adapters: [makeAdapter()] });
  const env = await app.read("dashboard", { range: "today" }, "zh-CN");
  assert.equal(env.surfaceId, "dashboard");
  assert.equal(env.status, "rules");
  assert.equal(env.source, "rules");
  assert.equal(env.canEnhance, false);
  assert.equal(env.lines.length, 2);
  assert.deepEqual(
    env.lines.slice(0, 2).map((line) => line.id),
    ["c1", "c2"],
  );
  assert.equal(env.lines[0].action?.id, "open_security");
  assert.equal(env.lines[0].action?.labelKey, "insights.actions.security");
});

test("read marks an enabled insight unavailable when no model profile is configured", async () => {
  const app = createPageInsightsApplication({
    adapters: [makeAdapter()],
    enhancer: {
      id: "profile-aware-enhancer",
      isAvailable: async () => false,
      enhance: async () => ({ status: "enhancer-unavailable", lines: [] }),
    },
    store: makeStore("enhanced-auto", {
      consentVersion: "1",
      consentedAtMs: 0,
    }),
  });

  const env = await app.read("dashboard", {}, "zh-CN");
  assert.equal(env.status, "enhancer-unavailable");
  assert.equal(env.canEnhance, false);
  assert.equal(env.autoEnhance, false);
});

test("read keeps enabled insight available when a model profile is configured", async () => {
  const app = createPageInsightsApplication({
    adapters: [makeAdapter()],
    enhancer: {
      id: "profile-aware-enhancer",
      isAvailable: async () => true,
      enhance: async () => ({ status: "enhanced-ready", lines: [] }),
    },
    store: makeStore("enhanced-auto", {
      consentVersion: "1",
      consentedAtMs: 0,
    }),
  });

  const env = await app.read("dashboard", {}, "zh-CN");
  assert.equal(env.status, "rules");
  assert.equal(env.canEnhance, true);
  assert.equal(env.autoEnhance, true);
});

test("read uses a valid persisted AI result for the first paint", async () => {
  let enhanceCalls = 0;
  const app = createPageInsightsApplication({
    adapters: [makeAdapter()],
    enhancer: {
      id: "cached-enhancer",
      readCached: async () => ({
        status: "enhanced-cached",
        modelLabel: "cached-model",
        lines: [{ candidateId: "c1", analysis: "cached analysis" }],
      }),
      enhance: async () => {
        enhanceCalls += 1;
        return { status: "enhancer-failed", lines: [] };
      },
    },
    store: makeStore("enhanced-auto", {
      consentVersion: "1",
      consentedAtMs: 0,
    }),
  });

  const env = await app.read("dashboard", {}, "zh-CN");
  assert.equal(env.status, "enhanced-cached");
  assert.equal(env.source, "enhanced");
  assert.equal(env.modelLabel, "cached-model");
  assert.equal(
    env.lines.find((line) => line.id === "c1")?.analysis,
    "cached analysis",
  );
  assert.equal(enhanceCalls, 0, "first paint must not start a model request");
});

test("enhance success replaces analysis and keeps fact key/params", async () => {
  const app = createPageInsightsApplication({
    adapters: [makeAdapter()],
    enhancer: makeEnhancer({
      status: "enhanced-ready",
      modelLabel: "fake-model",
      lines: [
        {
          candidateId: "c1",
          analysis: "risk analysis",
          actionId: "open_distill",
        },
        { candidateId: "c2", analysis: "info analysis" },
      ],
    }),
    store: makeStore("enhanced-manual"),
  });
  const env = await app.enhance(
    "dashboard",
    { range: "today" },
    { locale: "zh-CN", reason: "manual" },
  );
  assert.equal(env.status, "enhanced-ready");
  assert.equal(env.source, "enhanced");
  assert.equal(env.modelLabel, "fake-model");

  const c1 = env.lines.find((line) => line.id === "c1");
  assert.ok(c1);
  assert.equal(c1.source, "enhanced");
  assert.equal(c1.analysis, "risk analysis");
  assert.equal(c1.key, "insights.page.dashboard.dashboard-security-risk");
  assert.deepEqual(c1.params, { count: 2 });
  assert.equal(c1.action?.id, "open_security");
  assert.equal(c1.action?.labelKey, "insights.actions.security");

  const c2 = env.lines.find((line) => line.id === "c2");
  assert.ok(c2);
  assert.equal(c2.analysis, "info analysis");
  assert.equal(c2.action, undefined);
});

test("quality gate keeps fact lines while suppressing real duplicate and generic model samples", async () => {
  const baseAdapter = makeAdapter();
  const qualityAdapter: PageInsightAdapter = {
    ...baseAdapter,
    composeCandidates: (): InsightCandidate[] => [
      {
        id: "security-safe",
        severity: "info",
        factKey: "insights.page.dashboard.dashboard-security-safe",
        factParams: {},
        evidenceRefs: ["e1"],
        allowedActionIds: [],
      },
      {
        id: "cache-zero",
        severity: "attention",
        factKey: "insights.page.dashboard.dashboard-efficiency",
        factParams: { name: "aipy", rate: 0 },
        evidenceRefs: ["e1"],
        allowedActionIds: ["open_tracker"],
        remoteEligible: false,
      },
      {
        id: "collection-guidance",
        severity: "info",
        factKey: "insights.page.dashboard.dashboard-guide-collection",
        factParams: {},
        evidenceRefs: ["e1"],
        allowedActionIds: [],
      },
      {
        id: "tool-guidance",
        severity: "info",
        factKey: "insights.page.agents.agents-guide-coverage",
        factParams: {},
        evidenceRefs: ["e1"],
        allowedActionIds: [],
      },
      {
        id: "useful-risk",
        severity: "risk",
        factKey: "insights.page.dashboard.dashboard-security-risk",
        factParams: { count: 2 },
        evidenceRefs: ["e1"],
        allowedActionIds: ["open_security"],
      },
    ],
  };
  const app = createPageInsightsApplication({
    adapters: [qualityAdapter],
    enhancer: makeEnhancer({
      status: "enhanced-ready",
      lines: [
        {
          candidateId: "security-safe",
          analysis: "今日安全扫描未发现风险，所有项目均通过检查。",
        },
        {
          candidateId: "cache-zero",
          analysis: "缓存命中率极低，建议复用上下文以降低成本。",
          actionId: "open_tracker",
        },
        {
          candidateId: "collection-guidance",
          analysis:
            "先确认数据来源持续采集中，首页结论才不会因采集断档而失真。",
        },
        {
          candidateId: "tool-guidance",
          analysis: "补齐未接入的本地工具，可使 Agent 总览覆盖更完整。",
        },
        {
          candidateId: "useful-risk",
          analysis: "应优先处置以缩短风险暴露时间。",
          actionId: "open_security",
        },
      ],
    }),
    store: makeStore("enhanced-manual"),
  });

  const env = await app.enhance(
    "dashboard",
    {},
    { locale: "zh-CN", reason: "manual" },
  );

  for (const id of [
    "security-safe",
    "cache-zero",
    "collection-guidance",
    "tool-guidance",
  ]) {
    const line = env.lines.find((item) => item.id === id);
    assert.ok(line, `${id} fact line must remain visible`);
    assert.equal(line.analysis, undefined);
    assert.equal(line.source, "rules");
  }
  const useful = env.lines.find((line) => line.id === "useful-risk");
  assert.equal(useful?.analysis, "应优先处置以缩短风险暴露时间。");
  assert.equal(useful?.source, "enhanced");
  assert.equal(env.source, "enhanced");
});

test("an entirely rejected enhancement falls back to the complete rules envelope", async () => {
  const baseAdapter = makeAdapter();
  const safeAdapter: PageInsightAdapter = {
    ...baseAdapter,
    composeCandidates: (): InsightCandidate[] => [
      {
        id: "security-safe",
        severity: "info",
        factKey: "insights.page.dashboard.dashboard-security-safe",
        factParams: {},
        evidenceRefs: ["e1"],
        allowedActionIds: [],
        mandatory: true,
      },
    ],
  };
  const app = createPageInsightsApplication({
    adapters: [safeAdapter],
    enhancer: makeEnhancer({
      status: "enhanced-ready",
      lines: [
        {
          candidateId: "security-safe",
          analysis: "今日安全扫描未发现风险，所有项目均通过检查。",
        },
      ],
    }),
    store: makeStore("enhanced-manual"),
  });

  const env = await app.enhance(
    "dashboard",
    {},
    { locale: "zh-CN", reason: "manual" },
  );

  assert.equal(env.status, "invalid-output");
  assert.equal(env.source, "rules");
  assert.ok(env.lines.length >= 1);
  assert.equal(
    env.lines.every((line) => line.source === "rules"),
    true,
  );
  assert.equal(env.lines[0]?.id, "security-safe");
  assert.equal(env.lines[0]?.analysis, undefined);
  assert.equal(env.lines[0]?.source, "rules");
});

test("enhance failure keeps rules lines identical to read", async () => {
  const failures = [
    "enhancer-unavailable",
    "budget-exceeded",
    "timeout",
    "enhancer-failed",
    "invalid-output",
  ] as const;
  for (const status of failures) {
    const app = createPageInsightsApplication({
      adapters: [makeAdapter()],
      enhancer: makeEnhancer({ status, lines: [] }),
      store: makeStore("enhanced-auto", {
        consentVersion: "1",
        consentedAtMs: 1,
      }),
      now: () => 2,
    });
    const readEnv = await app.read("dashboard", { range: "today" }, "zh-CN");
    const env = await app.enhance(
      "dashboard",
      { range: "today" },
      { locale: "zh-CN", reason: "auto" },
    );
    assert.equal(env.status, status);
    assert.deepEqual(env.lines, readEnv.lines);
    assert.equal(env.source, "rules");
  }
});

test("reports when privacy filtering leaves no eligible remote candidates", async () => {
  const baseAdapter = makeAdapter();
  const localOnlyAdapter: PageInsightAdapter = {
    ...baseAdapter,
    composeCandidates(bundle) {
      return baseAdapter.composeCandidates(bundle).map((candidate) => ({
        ...candidate,
        remoteEligible: false,
      }));
    },
  };
  const app = createPageInsightsApplication({
    adapters: [localOnlyAdapter],
    enhancer: makeEnhancer({ status: "enhanced-ready", lines: [] }),
    store: makeStore("enhanced-manual"),
  });

  const env = await app.enhance(
    "dashboard",
    {},
    { locale: "zh-CN", reason: "manual" },
  );

  assert.equal(env.status, "no-eligible-candidates");
  assert.equal(env.source, "rules");
  assert.equal(
    env.lines.every((line) => line.source === "rules"),
    true,
  );
});

test("widget truncates to a single line", async () => {
  const app = createPageInsightsApplication({
    adapters: [makeAdapter("widget")],
  });
  const env = await app.read("widget", {}, "zh-CN");
  assert.equal(env.lines.length, 1);
  assert.equal(env.lines[0].id, "c1");
});

test("enhance in rules mode or without enhancer returns enhancer-unavailable", async () => {
  const rulesMode = createPageInsightsApplication({
    adapters: [makeAdapter()],
    enhancer: makeEnhancer({ status: "enhanced-ready", lines: [] }),
  });
  const rulesEnv = await rulesMode.enhance(
    "dashboard",
    {},
    { locale: "zh-CN", reason: "manual" },
  );
  assert.equal(rulesEnv.status, "enhancer-unavailable");
  assert.equal(rulesEnv.source, "rules");

  const noEnhancer = createPageInsightsApplication({
    adapters: [makeAdapter()],
    store: makeStore("enhanced-auto"),
  });
  const noEnhancerEnv = await noEnhancer.enhance(
    "dashboard",
    {},
    { locale: "zh-CN", reason: "auto" },
  );
  assert.equal(noEnhancerEnv.status, "enhancer-unavailable");
});

test("enhancement reason cannot bypass the effective mode or auto consent", async () => {
  let calls = 0;
  const enhancer: InsightEnhancerPort = {
    id: "counting",
    async enhance() {
      calls += 1;
      return { status: "enhanced-ready", lines: [] };
    },
  };
  for (const [mode, reason, overrides] of [
    ["rules", "manual", {}],
    ["enhanced-manual", "auto", {}],
    ["enhanced-auto", "manual", { consentVersion: "1", consentedAtMs: 1 }],
    ["enhanced-auto", "auto", { consentVersion: null, consentedAtMs: null }],
  ] as const) {
    const app = createPageInsightsApplication({
      adapters: [makeAdapter()],
      enhancer,
      store: makeStore(mode, overrides),
      now: () => 2,
    });
    const env = await app.enhance("dashboard", {}, { locale: "zh-CN", reason });
    assert.equal(env.status, "enhancer-unavailable");
  }
  assert.equal(calls, 0);
});

test("effective profile and daily limit are forwarded to the enhancer", async () => {
  let captured: InsightEnhancementInput | undefined;
  const app = createPageInsightsApplication({
    adapters: [makeAdapter()],
    enhancer: {
      id: "capture",
      async enhance(input) {
        captured = input;
        return { status: "enhancer-failed", lines: [] };
      },
    },
    store: makeStore("enhanced-manual", {
      profileId: "profile-selected",
      dailyCallLimit: 7,
    }),
  });
  await app.enhance("dashboard", {}, { locale: "zh-CN", reason: "manual" });
  assert.equal(captured?.profileId, "profile-selected");
  assert.equal(captured?.dailyCallLimit, 7);
  assert.equal(captured?.adapterVersion, 1);
  assert.equal(captured?.cacheTtlMs, 60 * 60 * 1000);
});

test("forwards the configured insight refresh interval to enhancement", async () => {
  let captured: InsightEnhancementInput | undefined;
  const app = createPageInsightsApplication({
    adapters: [makeAdapter()],
    enhancer: {
      id: "capture-refresh",
      async enhance(input) {
        captured = input;
        return { status: "enhancer-failed", lines: [] };
      },
    },
    store: makeStore("enhanced-manual", {}, 2 * 60 * 60 * 1000),
  });

  await app.enhance("dashboard", {}, { locale: "zh-CN", reason: "manual" });
  assert.equal(captured?.cacheTtlMs, 2 * 60 * 60 * 1000);
});

test("model selection and order control non-mandatory lines while mandatory safety stays first", async () => {
  const adapter = makeAdapter();
  const originalCompose = adapter.composeCandidates;
  const rankedAdapter: PageInsightAdapter = {
    ...adapter,
    composeCandidates(bundle) {
      return [
        ...originalCompose(bundle),
        {
          id: "c3",
          severity: "attention",
          factKey: "insights.page.dashboard.dashboard-watch",
          factParams: { agents: 7, blocked: 0, hours: 1, distillable: 0 },
          evidenceRefs: ["e1"],
          allowedActionIds: [],
        },
        {
          id: "c4",
          severity: "risk",
          factKey: "insights.page.dashboard.dashboard-watch",
          factParams: { agents: 8, blocked: 0, hours: 1, distillable: 0 },
          evidenceRefs: ["e1"],
          allowedActionIds: [],
        },
      ];
    },
  };
  const app = createPageInsightsApplication({
    adapters: [rankedAdapter],
    enhancer: makeEnhancer({
      status: "enhanced-ready",
      lines: [
        { candidateId: "c3", analysis: "attention selected first" },
        { candidateId: "c2", analysis: "info selected second" },
        { candidateId: "c1", analysis: "mandatory returned last" },
      ],
    }),
    store: makeStore("enhanced-manual"),
  });

  const env = await app.enhance(
    "dashboard",
    {},
    {
      locale: "zh-CN",
      reason: "manual",
    },
  );
  assert.deepEqual(
    env.lines.slice(0, 4).map((line) => line.id),
    ["c1", "c3", "c2", "c4"],
  );
  assert.equal(env.lines.length, 4);
  assert.equal(env.lines[0]?.severity, "risk");
  assert.equal(env.lines[0]?.source, "enhanced");
  assert.equal(env.lines[1]?.source, "enhanced");
  assert.equal(env.lines[2]?.source, "enhanced");
  assert.equal(env.lines[3]?.source, "rules");
});

test("private local candidates stay out of remote input", async () => {
  let captured: InsightEnhancementInput | undefined;
  const adapter = makeAdapter();
  const privacyAdapter: PageInsightAdapter = {
    ...adapter,
    composeCandidates(bundle) {
      return [
        {
          id: "private-project",
          severity: "attention",
          factKey: "insights.page.tracker.tracker-top-project",
          factParams: { name: "Project Aurora Secret" },
          evidenceRefs: ["e1"],
          allowedActionIds: ["open_tracker"],
          actionId: "open_tracker",
          remoteEligible: false,
        },
        ...adapter.composeCandidates(bundle),
      ];
    },
  };
  const app = createPageInsightsApplication({
    adapters: [privacyAdapter],
    enhancer: {
      id: "capture",
      async enhance(input) {
        captured = input;
        return {
          status: "enhanced-ready",
          lines: [{ candidateId: "c1", analysis: "safe analysis" }],
        };
      },
    },
    store: makeStore("enhanced-manual"),
  });
  const env = await app.enhance(
    "dashboard",
    {},
    {
      locale: "zh-CN",
      reason: "manual",
    },
  );

  assert.ok(captured);
  assert.equal(JSON.stringify(captured.candidates).includes("Aurora"), false);
  assert.equal(
    captured.candidates.some((candidate) => candidate.id === "private-project"),
    false,
  );
  assert.equal(captured.candidates.length, 2);
  const local = env.lines.find((line) => line.id === "private-project");
  assert.deepEqual(local?.params, { name: "Project Aurora Secret" });
  assert.equal(local?.source, "rules");
});

test("valid model lines stay enhanced and rule candidates fill the ten-line envelope", async () => {
  const adapter = makeAdapter();
  const sevenCandidateAdapter: PageInsightAdapter = {
    ...adapter,
    composeCandidates: (): InsightCandidate[] =>
      Array.from({ length: 10 }, (_, index) => {
        const id = `c${index + 1}`;
        const candidate: InsightCandidate =
          index === 0
            ? {
                id,
                severity: "risk",
                factKey: "insights.page.dashboard.dashboard-security-risk",
                factParams: { count: 2 },
                evidenceRefs: ["e1"],
                allowedActionIds: ["open_security"],
                actionId: "open_security",
                mandatory: true,
              }
            : index === 1
              ? {
                  id,
                  severity: "info",
                  factKey: "insights.page.dashboard.dashboard-guide-collection",
                  factParams: { tokens: 3495068214 },
                  evidenceRefs: ["e1"],
                  allowedActionIds: [],
                }
              : {
                  id,
                  severity: "info",
                  factKey: "insights.page.dashboard.dashboard-watch",
                  factParams: {
                    agents: index,
                    blocked: 0,
                    hours: index,
                    distillable: 0,
                  },
                  evidenceRefs: ["e1"],
                  allowedActionIds: [],
                };
        return candidate;
      }),
  };
  let captured: InsightEnhancementInput | undefined;
  const app = createPageInsightsApplication({
    adapters: [sevenCandidateAdapter],
    enhancer: {
      id: "five-line-enhancer",
      async enhance(input) {
        captured = input;
        return {
          status: "enhanced-ready",
          modelLabel: "fake-model",
          lines: input.candidates.slice(0, 5).map((candidate, index) => ({
            candidateId: candidate.id,
            analysis: `analysis ${index + 1}`,
          })),
        };
      },
    },
    store: makeStore("enhanced-manual"),
  });

  const env = await app.enhance(
    "dashboard",
    {},
    { locale: "zh-CN", reason: "manual" },
  );

  assert.equal(captured?.candidates.length, 10);
  assert.ok(env.lines.length <= 10);
  assert.equal(env.lines.length, 10);
  const enhanced = env.lines.filter((line) => line.source === "enhanced");
  assert.ok(enhanced.length > 0);
  assert.ok(enhanced.length <= 10);
  assert.equal(
    new Set(env.lines.map((line) => line.id)).size,
    env.lines.length,
  );
  const tokenLine = env.lines.find((line) => line.id === "c2");
  assert.equal(tokenLine?.params.tokens, "3.5B");
  assert.notEqual(tokenLine?.params.tokens, 3495068214);
  assert.equal(
    enhanced.every((line) => typeof line.analysis === "string"),
    true,
  );
  assert.equal(
    env.lines.some((line) => line.source === "rules"),
    true,
  );
});

test("evidence changing during generation discards the old enhancement", async () => {
  let reads = 0;
  const baseAdapter = makeAdapter();
  const changingAdapter: PageInsightAdapter = {
    ...baseAdapter,
    async loadEvidence(scope) {
      reads += 1;
      return {
        surfaceId: "dashboard",
        scope,
        observedAt: `2026-08-07T00:00:0${reads}.000Z`,
        evidence: [
          {
            id: "e1",
            kind: "metric",
            value: reads,
            observedAt: `2026-08-07T00:00:0${reads}.000Z`,
            freshness: "fresh",
            sensitivity: "aggregate",
          },
        ],
      };
    },
    composeCandidates(bundle) {
      const count = Number(bundle.evidence[0]?.value ?? 0);
      return [
        {
          id: "c1",
          severity: "risk",
          factKey: "insights.page.dashboard.dashboard-security-risk",
          factParams: { count },
          evidenceRefs: ["e1"],
          allowedActionIds: ["open_security"],
          mandatory: true,
        },
      ];
    },
  };
  const app = createPageInsightsApplication({
    adapters: [changingAdapter],
    enhancer: makeEnhancer({
      status: "enhanced-ready",
      lines: [{ candidateId: "c1", analysis: "old analysis" }],
    }),
    store: makeStore("enhanced-manual"),
  });
  const env = await app.enhance(
    "dashboard",
    {},
    {
      locale: "zh-CN",
      reason: "manual",
    },
  );

  assert.equal(reads, 2);
  assert.equal(env.status, "rules");
  assert.equal(env.source, "rules");
  assert.deepEqual(env.lines[0]?.params, { count: 2 });
  assert.equal(env.lines[0]?.analysis, undefined);
});

test("sampling timestamps changing during generation preserve the enhancement", async () => {
  let reads = 0;
  const baseAdapter = makeAdapter();
  const resamplingAdapter: PageInsightAdapter = {
    ...baseAdapter,
    async loadEvidence(scope) {
      reads += 1;
      const observedAt = `2026-08-07T00:00:0${reads}.000Z`;
      return {
        surfaceId: "dashboard",
        scope,
        observedAt,
        evidence: [
          {
            id: "e1",
            kind: "metric",
            value: 5,
            observedAt,
            freshness: "fresh",
            sensitivity: "aggregate",
          },
        ],
      };
    },
  };
  const app = createPageInsightsApplication({
    adapters: [resamplingAdapter],
    enhancer: makeEnhancer({
      status: "enhanced-ready",
      lines: [{ candidateId: "c1", analysis: "current analysis" }],
    }),
    store: makeStore("enhanced-manual"),
  });

  const env = await app.enhance(
    "dashboard",
    {},
    { locale: "zh-CN", reason: "manual" },
  );

  assert.equal(reads, 2);
  assert.equal(env.status, "enhanced-ready");
  assert.equal(env.source, "enhanced");
  assert.equal(env.lines[0]?.analysis, "current analysis");
});

test("read advertises auto enhancement only with current valid consent", async () => {
  const enhancer = makeEnhancer({ status: "enhanced-ready", lines: [] });
  const authorized = createPageInsightsApplication({
    adapters: [makeAdapter()],
    enhancer,
    store: makeStore("enhanced-auto", {
      consentVersion: "1",
      consentedAtMs: 1,
    }),
    now: () => 2,
  });
  assert.equal(
    (await authorized.read("dashboard", {}, "zh-CN")).autoEnhance,
    true,
  );
  const stale = createPageInsightsApplication({
    adapters: [makeAdapter()],
    enhancer,
    store: makeStore("enhanced-auto", {
      consentVersion: "old",
      consentedAtMs: 1,
    }),
    now: () => 2,
  });
  assert.equal((await stale.read("dashboard", {}, "zh-CN")).autoEnhance, false);
});

test("read keeps renderer auto enhancement enabled during a refresh batch", async () => {
  let active = true;
  const app = createPageInsightsApplication({
    adapters: [makeAdapter()],
    enhancer: makeEnhancer({ status: "enhanced-ready", lines: [] }),
    store: makeStore(
      "enhanced-auto",
      { consentVersion: "1", consentedAtMs: 1 },
      60 * 60 * 1000,
      () => active,
    ),
    now: () => 2,
  });

  // A page visit during a batch may also enhance; the generation reservation
  // (not a global lock) coordinates ownership with the batch.
  assert.equal((await app.read("dashboard", {}, "zh-CN")).autoEnhance, true);
  active = false;
  assert.equal((await app.read("dashboard", {}, "zh-CN")).autoEnhance, true);
});

test("read throws AppError when the surface has no adapter", async () => {
  const app = createPageInsightsApplication({ adapters: [makeAdapter()] });
  await assert.rejects(
    () => app.read("security", {}, "zh-CN"),
    (err: unknown) => err instanceof AppError && err.code === "errors.generic",
  );
});

test("page sources never import the ai-orchestration module", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const files = readdirSync(dir).filter((name) => name.endsWith(".ts"));
  for (const file of files) {
    if (file.endsWith(".test.ts")) continue;
    const source = readFileSync(path.join(dir, file), "utf8");
    assert.doesNotMatch(
      source,
      /ai-orchestration/,
      `${file} must not import ai-orchestration`,
    );
  }
});
