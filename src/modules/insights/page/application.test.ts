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

function makeStore(mode: InsightMode = "rules"): InsightStorePort {
  return {
    getEffectivePreference: () => ({
      scopeKey: "global",
      mode,
      profileId: null,
      consentVersion: null,
      consentedAtMs: null,
      dailyCallLimit: null,
      updatedAtMs: 0,
    }),
    setPreference: () => {},
  };
}

function makeEnhancer(result: InsightEnhancementResult): InsightEnhancerPort {
  return {
    id: "fake-enhancer",
    enhance: async () => result,
  };
}

test("read returns a complete rules envelope in default rules mode", async () => {
  const app = createPageInsightsApplication({ adapters: [makeAdapter()] });
  const env = await app.read("dashboard", { range: "today" }, "zh-CN");
  assert.equal(env.surfaceId, "dashboard");
  assert.equal(env.status, "rules");
  assert.equal(env.source, "rules");
  assert.equal(env.canEnhance, false);
  assert.deepEqual(
    env.lines.map((line) => line.id),
    ["c1", "c2"],
  );
  assert.equal(env.lines[0].action?.id, "open_security");
  assert.equal(env.lines[0].action?.labelKey, "insights.actions.security");
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
  assert.equal(c1.action?.id, "open_distill");
  assert.equal(c1.action?.labelKey, "insights.actions.distill");

  const c2 = env.lines.find((line) => line.id === "c2");
  assert.ok(c2);
  assert.equal(c2.analysis, "info analysis");
  assert.equal(c2.action, undefined);
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
      store: makeStore("enhanced-auto"),
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
