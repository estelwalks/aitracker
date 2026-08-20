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
} from "../insights/page/contracts.ts";
import { suggestionFor, wasteIndex } from "./application/tracker.ts";

const LOW_CACHE_THRESHOLD = 40;

function composeTrackerCandidates(
  bundle: InsightEvidenceBundle,
): readonly InsightCandidate[] {
  const tokens = metricValue(bundle, "tracker.tokens");
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

  if (tokens != null && tokens > 0 && topSource != null) {
    candidates.push({
      id: "tracker.burn-leader",
      severity: "info",
      factKey: "insights.page.tracker.tracker-burn-leader",
      factParams: { name: String(topSource.value), tokens },
      evidenceRefs: ["tracker.topSource", "tracker.tokens"],
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

  if (candidates.length === 0) {
    candidates.push({
      id: "tracker.empty",
      severity: "info",
      factKey: "insights.page.tracker.tracker-empty",
      factParams: {},
      evidenceRefs: [],
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
    );
  }

  const withCache = sources.filter((source) => source.inputTokens > 0);
  const lowCache = withCache.reduce(
    (best, source) => {
      const rate = (source.cachedInputTokens / source.inputTokens) * 100;
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
        topProject.key,
        observedAt,
        freshness,
      ),
    );
  }

  const withTokens = sources.filter((source) => source.totalTokens > 0);
  const wasteLeader = withTokens.reduce(
    (best, source) => {
      const cacheRate =
        source.inputTokens > 0
          ? (source.cachedInputTokens / source.inputTokens) * 100
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
    const cacheRate =
      source.inputTokens > 0
        ? (source.cachedInputTokens / source.inputTokens) * 100
        : null;
    const outputRatio =
      source.totalTokens > 0 ? source.outputTokens / source.totalTokens : 0;
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
  const blocked = metricValue(bundle, "agents.blocked");
  const hours = metricValue(bundle, "agents.hours");
  const lowCacheRate = metricValue(bundle, "agents.lowCacheRate");
  const lowCacheSource = bundle.evidence.find(
    (item) =>
      item.id === "agents.lowCacheSource" && typeof item.value === "string",
  );
  const candidates: InsightCandidate[] = [];

  if (
    lowCacheRate != null &&
    lowCacheRate < LOW_CACHE_THRESHOLD &&
    lowCacheSource != null
  ) {
    candidates.push({
      id: "agents.focus-cache",
      severity: "attention",
      factKey: "insights.page.agents.agents-focus-cache",
      factParams: { name: String(lowCacheSource.value), rate: lowCacheRate },
      evidenceRefs: ["agents.lowCacheSource", "agents.lowCacheRate"],
      allowedActionIds: ["open_tracker"],
      actionId: "open_tracker",
    });
  }

  if (active != null && active > 0) {
    candidates.push({
      id: "agents.overview",
      severity: "info",
      factKey: "insights.page.agents.agents-overview",
      factParams: {
        count: active,
        blocked: blocked ?? 0,
        hours: hours ?? 0,
      },
      evidenceRefs: ["agents.activeSources", "agents.blocked", "agents.hours"],
      allowedActionIds: ["open_sources", "open_tracker"],
      actionId: "open_sources",
    });
    candidates.push({
      id: "agents.prompt-guide",
      severity: "info",
      factKey: "insights.page.agents.agents-prompt-guide",
      factParams: {},
      evidenceRefs: ["agents.activeSources"],
      allowedActionIds: ["open_tracker"],
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
  const { usageSnapshot, sessionSnapshot, monitoring } =
    await getCompositionRoot();
  await usageSnapshot.ensureHydrated();
  await sessionSnapshot.ensureHydrated();
  const latest = usageSnapshot.readLatest();
  const snapshot = latest.data;

  if (snapshot == null) {
    return emptyBundle("agents", scope, observedAt, true);
  }

  const freshness = freshnessOf(snapshot.generatedAt, nowMs);
  const sources = snapshot.sources;
  const activeSources = sources.filter((source) => source.events > 0).length;

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
  ];

  const bySource = snapshot.bySource.filter((source) => source.events > 0);
  const withCache = bySource.filter((source) => source.inputTokens > 0);
  const lowCache = withCache.reduce(
    (best, source) => {
      const rate = (source.cachedInputTokens / source.inputTokens) * 100;
      return best == null || rate < best.rate
        ? { key: source.key, rate }
        : best;
    },
    undefined as { key: string; rate: number } | undefined,
  );
  if (lowCache != null) {
    evidence.push(
      statusEvidence(
        "agents.lowCacheSource",
        lowCache.key,
        observedAt,
        freshness,
      ),
      metricEvidence(
        "agents.lowCacheRate",
        lowCache.rate,
        observedAt,
        freshness,
        "percent",
      ),
    );
  }

  const sessionsLatest = sessionSnapshot.readLatest();
  evidence.push(
    metricEvidence(
      "agents.sessions",
      sessionsLatest.data?.sessions.length ?? 0,
      observedAt,
      freshnessOf(sessionsLatest.data?.generatedAt ?? null, nowMs),
      "count",
    ),
  );

  const monitoringStatus = await monitoring.status().catch(() => null);
  // Blocked = risky assets surfaced by the last security pass (0 when none).
  evidence.push(
    metricEvidence(
      "agents.blocked",
      monitoringStatus?.security != null
        ? monitoringStatus.security.dangerousCount +
            monitoringStatus.security.suspiciousCount
        : 0,
      observedAt,
      freshnessOf(monitoringStatus?.security?.assessedAt ?? null, nowMs),
      "count",
    ),
    // TODO(metrics): hours-saved is not yet measured; report an honest 0.
    metricEvidence("agents.hours", 0, observedAt, "unknown", "count"),
  );

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
  adapterVersion: 1,
  loadEvidence: loadTrackerEvidence,
  composeCandidates: composeTrackerCandidates,
};

export const agentsInsightAdapter: PageInsightAdapter = {
  surfaceId: "agents",
  adapterVersion: 1,
  loadEvidence: loadAgentsEvidence,
  composeCandidates: composeAgentsCandidates,
};
