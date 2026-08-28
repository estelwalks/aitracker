/**
 * Page-insight evidence adapters for the `tracker` and `agents` surfaces.
 *
 * Evidence sources (all O(1) read models, never a scan):
 *  - unified Usage snapshot (token/event totals, per-tool breakdown, cache rate)
 *  - unified Session snapshot (session count for the agents overview)
 *
 * Fact keys are the canonical `insights.page.<surface>.<ruleId>` vocabulary
 * declared by `PAGE_RULE_IDS` (M1). Numbers and names in candidates are copied
 * from the bundle evidence — never invented.
 */
import {
  assertEntityId,
  emptyBundle,
  freshnessOf,
  metricEvidence,
  metricValue,
  statusEvidence,
} from "../../app/insights/evidence-util.server.ts";
import type {
  InsightCandidate,
  InsightEvidenceBundle,
  InsightScope,
  PageInsightAdapter,
} from "../insights/index.ts";
import { getUsagePlan } from "../../lib/tool-registry/registry.ts";
import { suggestionFor, wasteIndex } from "./application/tracker.ts";

const LOW_CACHE_THRESHOLD = 40;

const CACHE_OBSERVABLE_NATIVE_READERS = new Set([
  "claude-rollout-v1",
  "codex-rollout-v1",
  "dsh-session-v1",
  "gemini-session-v1",
  "grok-turn-v1",
  "openclaw-session-v1",
  "workbuddy-native",
]);

/** Missing cache columns are normalized to zero by aggregation, so zero alone
 * cannot prove a measured miss rate. Observability comes from the registry's
 * mapping/reader contract instead of tool ids or aggregate values. */
export function isCacheUsageObservable(sourceId: string): boolean {
  const plan = getUsagePlan(sourceId);
  if (plan == null) return false;
  if (plan.mapping != null) {
    return (plan.mapping.cachedInputTokens?.length ?? 0) > 0;
  }
  return CACHE_OBSERVABLE_NATIVE_READERS.has(plan.reader);
}

function cacheDenominator(source: {
  inputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
}): number {
  return (
    source.inputTokens +
    source.cachedInputTokens +
    source.cacheCreationInputTokens
  );
}

function composeTrackerCandidates(
  bundle: InsightEvidenceBundle,
): readonly InsightCandidate[] {
  const tokens = metricValue(bundle, "tracker.tokens");
  const events = metricValue(bundle, "tracker.events");
  const averageTokens = metricValue(bundle, "tracker.averageTokensPerEvent");
  const topSourceTokens = metricValue(bundle, "tracker.topSourceTokens");
  const topSourceShare = metricValue(bundle, "tracker.topSourceShare");
  const observableCacheSources = metricValue(
    bundle,
    "tracker.cacheObservableSources",
  );
  const topSource = bundle.evidence.find(
    (item) => item.id === "tracker.topSource" && typeof item.value === "string",
  );
  const lowCacheSource = bundle.evidence.find(
    (item) =>
      item.id === "tracker.lowCacheSource" && typeof item.value === "string",
  );
  const lowCacheRate = metricValue(bundle, "tracker.lowCacheRate");
  const wasteLeaderName = bundle.evidence.find(
    (item) =>
      item.id === "tracker.wasteLeaderName" && typeof item.value === "string",
  );
  const wasteLeaderRate = metricValue(bundle, "tracker.wasteLeaderRate");
  const topModel = bundle.evidence.find(
    (item) => item.id === "tracker.topModel" && typeof item.value === "string",
  );
  const topProject = bundle.evidence.find(
    (item) =>
      item.id === "tracker.topProject" && typeof item.value === "string",
  );
  const suggestCount = metricValue(bundle, "tracker.suggestCount");
  const candidates: InsightCandidate[] = [];

  if (tokens != null && events != null) {
    candidates.push({
      id: "tracker.consumption",
      severity: "info",
      factKey: "insights.page.tracker.tracker-guide-consumption",
      factParams: { tokens, events },
      evidenceRefs: ["tracker.tokens", "tracker.events"],
      allowedActionIds: ["open_tracker"],
      actionId: "open_tracker",
    });
  }

  if (averageTokens != null) {
    candidates.push({
      id: "tracker.average",
      severity: "info",
      factKey: "insights.page.tracker.tracker-guide-optimize",
      factParams: { average: averageTokens },
      evidenceRefs: ["tracker.averageTokensPerEvent"],
      allowedActionIds: ["open_tracker"],
      actionId: "open_tracker",
    });
  }

  if (topSourceTokens != null && topSourceTokens > 0 && topSource != null) {
    candidates.push({
      id: "tracker.burn-leader",
      severity: "info",
      factKey: "insights.page.tracker.tracker-burn-leader",
      factParams: { name: String(topSource.value), tokens: topSourceTokens },
      evidenceRefs: ["tracker.topSource", "tracker.topSourceTokens"],
      allowedActionIds: ["open_tracker"],
      actionId: "open_tracker",
    });
  }

  if (topSource != null && topSourceShare != null) {
    candidates.push({
      id: "tracker.concentration",
      severity: "info",
      factKey: "insights.page.tracker.tracker-guide-concentration",
      factParams: { name: String(topSource.value), rate: topSourceShare },
      evidenceRefs: ["tracker.topSource", "tracker.topSourceShare"],
      allowedActionIds: ["open_tracker"],
      actionId: "open_tracker",
    });
  }

  if (wasteLeaderName != null && wasteLeaderRate != null) {
    candidates.push({
      id: "tracker.waste-leader",
      severity: "attention",
      factKey: "insights.page.tracker.tracker-waste-leader",
      factParams: {
        name: String(wasteLeaderName.value),
        rate: wasteLeaderRate,
      },
      evidenceRefs: ["tracker.wasteLeaderName", "tracker.wasteLeaderRate"],
      allowedActionIds: ["open_tracker"],
      actionId: "open_tracker",
    });
  }

  if (topModel != null) {
    candidates.push({
      id: "tracker.top-model",
      severity: "info",
      factKey: "insights.page.tracker.tracker-top-model",
      factParams: { name: String(topModel.value) },
      evidenceRefs: ["tracker.topModel"],
      allowedActionIds: ["open_tracker"],
      actionId: "open_tracker",
    });
  }

  if (topProject != null) {
    candidates.push({
      id: "tracker.top-project",
      severity: "info",
      factKey: "insights.page.tracker.tracker-top-project",
      factParams: { name: String(topProject.value) },
      evidenceRefs: ["tracker.topProject"],
      allowedActionIds: ["open_tracker"],
      actionId: "open_tracker",
      remoteEligible: false,
    });
  }

  if (
    lowCacheRate != null &&
    lowCacheRate < LOW_CACHE_THRESHOLD &&
    lowCacheSource != null
  ) {
    candidates.push({
      id: "tracker.cache-low",
      severity: "attention",
      factKey: "insights.page.tracker.tracker-cache-low",
      factParams: { name: String(lowCacheSource.value), rate: lowCacheRate },
      evidenceRefs: ["tracker.lowCacheSource", "tracker.lowCacheRate"],
      allowedActionIds: ["open_tracker"],
      actionId: "open_tracker",
    });
  }

  if (observableCacheSources != null && observableCacheSources > 0) {
    candidates.push({
      id: "tracker.cache-coverage",
      severity: "info",
      factKey: "insights.page.tracker.tracker-guide-cache",
      factParams: { count: observableCacheSources },
      evidenceRefs: ["tracker.cacheObservableSources"],
      allowedActionIds: ["open_tracker"],
      actionId: "open_tracker",
    });
  }

  if (suggestCount != null && suggestCount > 0) {
    candidates.push({
      id: "tracker.suggest",
      severity: "info",
      factKey: "insights.page.tracker.tracker-suggest",
      factParams: { count: suggestCount },
      evidenceRefs: ["tracker.suggestCount"],
      allowedActionIds: ["open_tracker"],
      actionId: "open_tracker",
    });
  }

  if (candidates.length === 0 && tokens != null && events != null) {
    candidates.push({
      id: "tracker.empty",
      severity: "info",
      factKey: "insights.page.tracker.tracker-empty",
      factParams: { tokens, events },
      evidenceRefs: ["tracker.tokens", "tracker.events"],
      allowedActionIds: ["open_sources"],
      actionId: "open_sources",
    });
  }
  return candidates;
}

async function loadTrackerEvidence(scope: InsightScope) {
  assertEntityId(scope.entityId);
  const nowMs = Date.now();
  const observedAt = new Date(nowMs).toISOString();

  const { getCompositionRoot } =
    await import("../../app/composition.server.ts");
  const { usageSnapshot } = await getCompositionRoot();
  await usageSnapshot.ensureHydrated();
  const latest = usageSnapshot.readLatest();
  const snapshot = latest.data;

  if (snapshot == null) {
    return emptyBundle("tracker", scope, observedAt, true);
  }

  const freshness = freshnessOf(snapshot.generatedAt, nowMs);
  const evidence = [
    metricEvidence(
      "tracker.tokens",
      snapshot.totals.totalTokens,
      observedAt,
      freshness,
      "tokens",
    ),
    metricEvidence(
      "tracker.events",
      snapshot.events,
      observedAt,
      freshness,
      "count",
    ),
  ];

  const sources = snapshot.bySource.filter((source) => source.events > 0);
  const topSource = sources.reduce(
    (best, source) => (source.totalTokens > best.totalTokens ? source : best),
    sources[0],
  );
  if (topSource != null) {
    evidence.push(
      statusEvidence("tracker.topSource", topSource.key, observedAt, freshness),
      metricEvidence(
        "tracker.topSourceTokens",
        topSource.totalTokens,
        observedAt,
        freshness,
        "tokens",
      ),
    );
    if (snapshot.totals.totalTokens > 0) {
      evidence.push(
        metricEvidence(
          "tracker.topSourceShare",
          Math.round(
            (topSource.totalTokens / snapshot.totals.totalTokens) * 100,
          ),
          observedAt,
          freshness,
          "percent",
        ),
      );
    }
  }

  const cacheObservableSources = sources.filter((source) =>
    isCacheUsageObservable(source.key),
  );
  evidence.push(
    metricEvidence(
      "tracker.cacheObservableSources",
      cacheObservableSources.length,
      observedAt,
      freshness,
      "count",
    ),
  );
  if (snapshot.events > 0) {
    evidence.push(
      metricEvidence(
        "tracker.averageTokensPerEvent",
        Math.round(snapshot.totals.totalTokens / snapshot.events),
        observedAt,
        freshness,
        "tokens",
      ),
    );
  }
  const withCache = cacheObservableSources.filter(
    (source) => cacheDenominator(source) > 0,
  );
  const lowCache = withCache.reduce(
    (best, source) => {
      const rate = (source.cachedInputTokens / cacheDenominator(source)) * 100;
      return best == null || rate < best.rate
        ? { key: source.key, rate }
        : best;
    },
    undefined as { key: string; rate: number } | undefined,
  );
  if (lowCache != null) {
    evidence.push(
      statusEvidence(
        "tracker.lowCacheSource",
        lowCache.key,
        observedAt,
        freshness,
      ),
      metricEvidence(
        "tracker.lowCacheRate",
        lowCache.rate,
        observedAt,
        freshness,
        "percent",
      ),
    );
  }

  const topModel = snapshot.byModel.reduce(
    (best, model) =>
      best == null || model.totalTokens > best.totalTokens ? model : best,
    undefined as (typeof snapshot.byModel)[number] | undefined,
  );
  if (topModel != null && topModel.totalTokens > 0) {
    evidence.push(
      statusEvidence("tracker.topModel", topModel.key, observedAt, freshness),
    );
  }

  const topProject = snapshot.byProject.reduce(
    (best, project) =>
      best == null || project.totalTokens > best.totalTokens ? project : best,
    undefined as (typeof snapshot.byProject)[number] | undefined,
  );
  if (topProject != null && topProject.totalTokens > 0) {
    evidence.push(
      statusEvidence(
        "tracker.topProject",
        // P2-1: hydrated snapshots key projects by ref hash — the display-safe
        // label (final segment) must be rendered instead of the hash.
        topProject.label ?? topProject.key,
        observedAt,
        freshness,
      ),
    );
  }

  const withTokens = sources.filter((source) => source.totalTokens > 0);
  const wasteLeader = withTokens.reduce(
    (best, source) => {
      const cacheRate =
        isCacheUsageObservable(source.key) && cacheDenominator(source) > 0
          ? (source.cachedInputTokens / cacheDenominator(source)) * 100
          : null;
      const outputRatio =
        source.totalTokens > 0 ? source.outputTokens / source.totalTokens : 0;
      const waste = wasteIndex(cacheRate, outputRatio);
      return best == null || waste > best.waste
        ? { key: source.key, waste }
        : best;
    },
    undefined as { key: string; waste: number } | undefined,
  );
  if (wasteLeader != null) {
    evidence.push(
      statusEvidence(
        "tracker.wasteLeaderName",
        wasteLeader.key,
        observedAt,
        freshness,
      ),
      metricEvidence(
        "tracker.wasteLeaderRate",
        Math.round(wasteLeader.waste),
        observedAt,
        freshness,
        "percent",
      ),
    );
  }

  const suggestCount = sources.filter((source) => {
    if (source.totalTokens <= 0) return false;
    const cacheRate =
      isCacheUsageObservable(source.key) && cacheDenominator(source) > 0
        ? (source.cachedInputTokens / cacheDenominator(source)) * 100
        : null;
    const outputRatio = source.outputTokens / source.totalTokens;
    return (
      suggestionFor({ cacheRate, outputRatio, tokens: source.totalTokens }) !==
      "none"
    );
  }).length;
  if (suggestCount > 0) {
    evidence.push(
      metricEvidence(
        "tracker.suggestCount",
        suggestCount,
        observedAt,
        freshness,
        "count",
      ),
    );
  }

  return {
    surfaceId: "tracker" as const,
    scope,
    observedAt,
    evidence,
    ...(snapshot.mode !== "real" ? { partial: true } : {}),
  };
}

function composeAgentsCandidates(
  bundle: InsightEvidenceBundle,
): readonly InsightCandidate[] {
  const active = metricValue(bundle, "agents.activeSources");
  const total = metricValue(bundle, "agents.totalSources");
  const available = metricValue(bundle, "agents.availableSources");
  const inactive = metricValue(bundle, "agents.inactiveSources");
  const sessions = metricValue(bundle, "agents.sessions");
  const events = metricValue(bundle, "agents.events");
  const tokens = metricValue(bundle, "agents.tokens");
  const topShare = metricValue(bundle, "agents.topShareRate");
  const topSource = bundle.evidence.find(
    (item) => item.id === "agents.topSource" && typeof item.value === "string",
  );
  const candidates: InsightCandidate[] = [];

  if (active != null && total != null && inactive != null) {
    candidates.push({
      id: "agents.overview",
      severity: "info",
      factKey: "insights.page.agents.agents-overview",
      factParams: { count: total, active, inactive },
      evidenceRefs: [
        "agents.totalSources",
        "agents.activeSources",
        "agents.inactiveSources",
      ],
      allowedActionIds: ["open_sources"],
      actionId: "open_sources",
    });
  }
  if (available != null) {
    candidates.push({
      id: "agents.available",
      severity: "info",
      factKey: "insights.page.agents.agents-focus-security",
      factParams: { available },
      evidenceRefs: ["agents.availableSources"],
      allowedActionIds: ["open_sources"],
      actionId: "open_sources",
    });
  }
  if (sessions != null) {
    candidates.push({
      id: "agents.sessions",
      severity: "info",
      factKey: "insights.page.agents.agents-guide-activity",
      factParams: { count: sessions },
      evidenceRefs: ["agents.sessions"],
      allowedActionIds: ["open_sessions"],
      actionId: "open_sessions",
    });
  }
  if (events != null && tokens != null) {
    candidates.push({
      id: "agents.usage",
      severity: "info",
      factKey: "insights.page.agents.agents-guide-prompt",
      factParams: { events, tokens },
      evidenceRefs: ["agents.events", "agents.tokens"],
      allowedActionIds: ["open_tracker"],
      actionId: "open_tracker",
    });
  }
  if (topSource != null && topShare != null) {
    candidates.push({
      id: "agents.primary",
      severity: "info",
      factKey: "insights.page.agents.agents-prompt-guide",
      factParams: { name: String(topSource.value), rate: topShare },
      evidenceRefs: ["agents.topSource", "agents.topShareRate"],
      allowedActionIds: ["open_tracker"],
      actionId: "open_tracker",
    });
  }
  return candidates;
}

async function loadAgentsEvidence(scope: InsightScope) {
  assertEntityId(scope.entityId);
  const nowMs = Date.now();
  const observedAt = new Date(nowMs).toISOString();

  const { getCompositionRoot } =
    await import("../../app/composition.server.ts");
  const { usageSnapshot, sessionSnapshot } = await getCompositionRoot();
  await usageSnapshot.ensureHydrated();
  await sessionSnapshot.ensureHydrated();
  const latest = usageSnapshot.readLatest();
  const snapshot = latest.data;

  if (snapshot == null) {
    return emptyBundle("agents", scope, observedAt, true);
  }

  const freshness = freshnessOf(snapshot.generatedAt, nowMs);
  const sources = snapshot.sources.filter(
    (source) =>
      source.detected === true || source.available || source.events > 0,
  );
  const activeSources = sources.filter((source) => source.events > 0).length;
  const availableSources = sources.filter((source) => source.available).length;
  const bySource = snapshot.bySource.filter((source) => source.events > 0);
  const topSource = bySource.reduce(
    (best, source) =>
      best == null || source.totalTokens > best.totalTokens ? source : best,
    undefined as (typeof bySource)[number] | undefined,
  );

  const evidence = [
    metricEvidence(
      "agents.activeSources",
      activeSources,
      observedAt,
      freshness,
      "count",
    ),
    metricEvidence(
      "agents.totalSources",
      sources.length,
      observedAt,
      freshness,
      "count",
    ),
    metricEvidence(
      "agents.availableSources",
      availableSources,
      observedAt,
      freshness,
      "count",
    ),
    metricEvidence(
      "agents.inactiveSources",
      Math.max(0, sources.length - activeSources),
      observedAt,
      freshness,
      "count",
    ),
    metricEvidence(
      "agents.events",
      snapshot.events,
      observedAt,
      freshness,
      "count",
    ),
    metricEvidence(
      "agents.tokens",
      snapshot.totals.totalTokens,
      observedAt,
      freshness,
      "tokens",
    ),
  ];

  if (topSource != null && snapshot.totals.totalTokens > 0) {
    evidence.push(
      statusEvidence("agents.topSource", topSource.key, observedAt, freshness),
      metricEvidence(
        "agents.topShareRate",
        Math.round((topSource.totalTokens / snapshot.totals.totalTokens) * 100),
        observedAt,
        freshness,
        "percent",
      ),
    );
  }

  const sessionsLatest = sessionSnapshot.readLatest();
  if (sessionsLatest.data != null) {
    evidence.push(
      metricEvidence(
        "agents.sessions",
        sessionsLatest.data.sessions.length,
        observedAt,
        freshnessOf(sessionsLatest.data.generatedAt, nowMs),
        "count",
      ),
    );
  }

  return {
    surfaceId: "agents" as const,
    scope,
    observedAt,
    evidence,
    ...(snapshot.mode !== "real" ? { partial: true } : {}),
  };
}

export const trackerInsightAdapter: PageInsightAdapter = {
  surfaceId: "tracker",
  adapterVersion: 3,
  loadEvidence: loadTrackerEvidence,
  composeCandidates: composeTrackerCandidates,
};

export const agentsInsightAdapter: PageInsightAdapter = {
  surfaceId: "agents",
  adapterVersion: 3,
  loadEvidence: loadAgentsEvidence,
  composeCandidates: composeAgentsCandidates,
};
