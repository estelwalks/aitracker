import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ENV } from "../lib/app-config.ts";
import { INSIGHT_SURFACE_IDS } from "../modules/insights/page/contracts.ts";
import {
  createInsightAdapterRegistry,
  createPageInsightsApplicationForRoot,
  resetPageInsightsApplicationForTests,
  type PageInsightsDependencies,
} from "./insight-registry.server.ts";
import {
  getCompositionRoot,
  resetCompositionRootForTests,
} from "./composition.server.ts";

async function withIsolatedDataRoot<T>(
  fn: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(
    join(tmpdir(), `aitracker-insight-${randomUUID()}-`),
  );
  const previous = process.env[ENV.USAGE_HOME];
  process.env[ENV.USAGE_HOME] = dir;
  resetCompositionRootForTests();
  resetPageInsightsApplicationForTests();
  try {
    return await fn(dir);
  } finally {
    resetCompositionRootForTests();
    resetPageInsightsApplicationForTests();
    if (previous === undefined) delete process.env[ENV.USAGE_HOME];
    else process.env[ENV.USAGE_HOME] = previous;
    await rm(dir, { recursive: true, force: true });
  }
}

function enhancedManualPreference() {
  return {
    scopeKey: "global",
    mode: "enhanced-manual" as const,
    profileId: null,
    consentVersion: null,
    consentedAtMs: null,
    dailyCallLimit: null,
    updatedAtMs: Date.now(),
  };
}

test("createInsightAdapterRegistry registers all 14 surface adapters", () => {
  const adapters = createInsightAdapterRegistry();
  assert.equal(adapters.length, 14);
  const surfaceIds = adapters.map((adapter) => adapter.surfaceId);
  assert.equal(new Set(surfaceIds).size, 14, "surface ids must be unique");
  for (const surfaceId of INSIGHT_SURFACE_IDS) {
    assert.ok(
      surfaceIds.includes(surfaceId),
      `missing adapter for surface ${surfaceId}`,
    );
  }
  for (const adapter of adapters) {
    assert.ok(adapter.adapterVersion >= 1, `${adapter.surfaceId} version`);
    assert.equal(
      typeof adapter.loadEvidence,
      "function",
      `${adapter.surfaceId} loadEvidence`,
    );
    assert.equal(
      typeof adapter.composeCandidates,
      "function",
      `${adapter.surfaceId} composeCandidates`,
    );
  }
});

test("composition root exposes the page-insights application", async () => {
  await withIsolatedDataRoot(async () => {
    const root = await getCompositionRoot();
    assert.ok(root.insights, "root.insights must be assembled");
    const envelope = await root.insights.read("dashboard", {}, "zh-CN");
    assert.equal(envelope.surfaceId, "dashboard");
    assert.ok(Array.isArray(envelope.lines));
  });
});

test("insight.killSwitch disables the enhancer (no profile read)", async () => {
  await withIsolatedDataRoot(async () => {
    const root = await getCompositionRoot();
    const deps: PageInsightsDependencies = {
      aiExecutor: root.aiExecutor,
      modelProfiles: root.modelProfiles,
      store: root.database.features.insights,
      runtimeFlags: root.database.features.runtimeFlags,
    };

    // Baseline: no kill switch → enhancement is available in enhanced mode.
    const profile = await root.modelProfiles.upsert({
      mode: "custom",
      protocol: "openai",
      name: "Insight test profile",
      apiKey: "sk-0123456789abcdef",
      endpoint: "https://example.invalid/v1",
      model: "test-model",
    });
    const activated = await root.modelProfiles.setActive(profile.id);
    assert.deepEqual(activated, { ok: true });
    root.database.features.insights.setPreference(enhancedManualPreference());
    const withEnhancer = await createPageInsightsApplicationForRoot(deps);
    const baseline = await withEnhancer.read("dashboard", {}, "zh-CN");
    assert.equal(baseline.canEnhance, true);

    // Kill switch on → enhancer not constructed; profile never read.
    await root.database.features.runtimeFlags.set("insight.killswitch", true);
    let getActiveViewCalls = 0;
    const killed = await createPageInsightsApplicationForRoot({
      ...deps,
      modelProfiles: {
        ...deps.modelProfiles,
        getActiveView: async () => {
          getActiveViewCalls += 1;
          return deps.modelProfiles.getActiveView();
        },
      },
    });
    root.database.features.insights.setPreference(enhancedManualPreference());
    const envelope = await killed.read("dashboard", {}, "zh-CN");
    assert.equal(
      envelope.canEnhance,
      false,
      "kill switch must disable enhance",
    );
    await killed.enhance(
      "dashboard",
      {},
      { locale: "zh-CN", reason: "manual" },
    );
    assert.equal(
      getActiveViewCalls,
      0,
      "kill switch must never read the model Profile",
    );
  });
});
