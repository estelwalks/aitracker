/**
 * Page-insight evidence adapters for the `dashboard` and `widget` surfaces.
 *
 * Evidence sources (all O(1) read models, never a scan):
 *  - unified Usage snapshot (event count + total tokens + per-source breakdown)
 *  - unified Session snapshot (session count)
 *  - monitoring heartbeat's security summary (assessed/risky asset counts)
 *
 * `widget` reuses the dashboard evidence and composes a single line. Numbers in
 * candidates are copied verbatim from the bundle evidence — never invented.
 * Fact keys are the canonical `insights.page.<surface>.<ruleId>` vocabulary
 * declared by `PAGE_RULE_IDS` (M1); each key is a real `MessageKey`.
 */
import {
  assertEntityId,
  emptyBundle,
  freshnessOf,
  metricEvidence,
  metricValue,
  statusEvidence,
} from "../../app/insights/evidence-util.server.ts";
import { getMonitoringSecuritySummary } from "../../app/security-summary.server.ts";
import type {
  InsightCandidate,
  InsightEvidenceBundle,
  InsightScope,
  PageInsightAdapter,
} from "../insights/page/contracts.ts";

const LOW_CACHE_THRESHOLD = 40;

function composeDashboardCandidates(
  bundle: InsightEvidenceBundle,
): readonly InsightCandidate[] {
  const risk = metricValue(bundle, "dashboard.securityRisk");
  const assessed = metricValue(bundle, "dashboard.securityAssessed");
  const events = metricValue(bundle, "dashboard.events");
  const tokens = metricValue(bundle, "dashboard.tokens");
  const sessions = metricValue(bundle, "dashboard.sessions");

  const candidates: InsightCandidate[] = [];

  if (risk != null && risk > 0) {
    candidates.push({
      id: "dashboard.security-risk",
      severity: "risk",
      factKey: "insights.page.dashboard.dashboard-security-risk",
      factParams: { count: risk },
      evidenceRefs: ["dashboard.securityRisk"],
      allowedActionIds: ["open_security"],
      actionId: "open_security",
      mandatory: true,
    });
  } else if (assessed != null && assessed > 0) {
    candidates.push({
      id: "dashboard.security-safe",
      severity: "info",
      factKey: "insights.page.dashboard.dashboard-security-safe",
      factParams: {},
      evidenceRefs: ["dashboard.securityAssessed"],
      allowedActionIds: ["open_security"],
      actionId: "open_security",
    });
  }

  if ((events != null && events > 0) || (tokens != null && tokens > 0)) {
    candidates.push({
      id: "dashboard.usage",
      severity: "info",
      factKey: "insights.page.dashboard.dashboard-usage",
      factParams: {
        events: events ?? 0,
        sessions: sessions ?? 0,
      },
      evidenceRefs: [
        "dashboard.events",
        "dashboard.tokens",
        "dashboard.sessions",
      ],
      allowedActionIds: ["open_sessions", "open_distill"],
      actionId: "open_sessions",
    });
  }

  const topSource = bundle.evidence.find(
    (item) =>
      item.id === "dashboard.topSource" && typeof item.value === "string",
  );
  const topShareRate = metricValue(bundle, "dashboard.topShareRate");
  if (topSource != null && topShareRate != null) {
    candidates.push({
      id: "dashboard.assets",
      severity: "info",
      factKey: "insights.page.dashboard.dashboard-assets",
      factParams: { name: String(topSource.value), rate: topShareRate },
      evidenceRefs: ["dashboard.topSource", "dashboard.topShareRate"],
      allowedActionIds: ["open_sessions"],
      actionId: "open_sessions",
    });
  }

  const lowCacheSource = bundle.evidence.find(
    (item) =>
      item.id === "dashboard.lowCacheSource" && typeof item.value === "string",
  );
  const lowCacheRate = metricValue(bundle, "dashboard.lowCacheRate");
  if (
    lowCacheRate != null &&
    lowCacheRate < LOW_CACHE_THRESHOLD &&
    lowCacheSource != null
  ) {
    candidates.push({
      id: "dashboard.efficiency",
      severity: "attention",
      factKey: "insights.page.dashboard.dashboard-efficiency",
      factParams: { name: String(lowCacheSource.value), rate: lowCacheRate },
      evidenceRefs: ["dashboard.lowCacheSource", "dashboard.lowCacheRate"],
      allowedActionIds: ["open_tracker"],
      actionId: "open_tracker",
    });
  }

  if (candidates.length === 0) {
    candidates.push({
      id: "dashboard.empty",
      severity: "info",
      factKey: "insights.page.dashboard.dashboard-empty",
      factParams: {},
      evidenceRefs: [],
      allowedActionIds: ["open_sources"],
      actionId: "open_sources",
    });
  }

  return candidates;
}

async function loadDashboardEvidence(scope: InsightScope) {
  assertEntityId(scope.entityId);
  const nowMs = Date.now();
  const observedAt = new Date(nowMs).toISOString();

  const { getCompositionRoot } =
    await import("../../app/composition.server.ts");
  const root = await getCompositionRoot();
  const { usageSnapshot, sessionSnapshot } = root;

  await usageSnapshot.ensureHydrated();
  const latest = usageSnapshot.readLatest();
  const snapshot = latest.data;
  const generatedAt = snapshot?.generatedAt ?? latest.generatedAt ?? null;
  const freshness = freshnessOf(generatedAt, nowMs);

  if (snapshot == null) {
    return emptyBundle("dashboard", scope, observedAt, true);
  }

  const evidence = [
    metricEvidence(
      "dashboard.events",
      snapshot.events,
      observedAt,
      freshness,
      "count",
    ),
    metricEvidence(
      "dashboard.tokens",
      snapshot.totals.totalTokens,
      observedAt,
      freshness,
      "tokens",
    ),
  ];

  const activeSources = snapshot.bySource.filter((source) => source.events > 0);
  const topSource = activeSources.reduce(
    (best, source) =>
      best == null || source.totalTokens > best.totalTokens ? source : best,
    undefined as (typeof activeSources)[number] | undefined,
  );
  if (topSource != null && snapshot.totals.totalTokens > 0) {
    evidence.push(
      statusEvidence(
        "dashboard.topSource",
        topSource.key,
        observedAt,
        freshness,
      ),
      metricEvidence(
        "dashboard.topShareRate",
        Math.round((topSource.totalTokens / snapshot.totals.totalTokens) * 100),
        observedAt,
        freshness,
        "percent",
      ),
    );
  }

  const withCache = activeSources.filter((source) => source.inputTokens > 0);
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
        "dashboard.lowCacheSource",
        lowCache.key,
        observedAt,
        freshness,
      ),
      metricEvidence(
        "dashboard.lowCacheRate",
        Math.round(lowCache.rate),
        observedAt,
        freshness,
        "percent",
      ),
    );
  }

  await sessionSnapshot.ensureHydrated();
  const sessionsLatest = sessionSnapshot.readLatest();
  evidence.push(
    metricEvidence(
      "dashboard.sessions",
      sessionsLatest.data?.sessions.length ?? 0,
      observedAt,
      freshnessOf(sessionsLatest.data?.generatedAt ?? null, nowMs),
      "count",
    ),
  );

  const securitySummary = await getMonitoringSecuritySummary();
  if (securitySummary != null) {
    const security = securitySummary;
    evidence.push(
      metricEvidence(
        "dashboard.securityAssessed",
        security.assessedAssetCount,
        observedAt,
        freshnessOf(security.assessedAt, nowMs),
        "count",
      ),
      metricEvidence(
        "dashboard.securityRisk",
        security.dangerousCount + security.suspiciousCount,
        observedAt,
        freshnessOf(security.assessedAt, nowMs),
        "count",
      ),
    );
  }

  return {
    surfaceId: "dashboard" as const,
    scope,
    observedAt,
    evidence,
    ...(snapshot.mode !== "real" ? { partial: true } : {}),
  };
}

export const dashboardInsightAdapter: PageInsightAdapter = {
  surfaceId: "dashboard",
  adapterVersion: 2,
  loadEvidence: loadDashboardEvidence,
  composeCandidates: composeDashboardCandidates,
};

export const widgetInsightAdapter: PageInsightAdapter = {
  surfaceId: "widget",
  adapterVersion: 1,
  async loadEvidence(scope) {
    // Widget reuses the dashboard read model verbatim; re-tag the surface id.
    const bundle = await loadDashboardEvidence(scope);
    return { ...bundle, surfaceId: "widget" as const };
  },
  composeCandidates(bundle) {
    const risk = metricValue(bundle, "dashboard.securityRisk");
    const sessions = metricValue(bundle, "dashboard.sessions");
    const lowCacheRate = metricValue(bundle, "dashboard.lowCacheRate");
    const lowCacheSource = bundle.evidence.find(
      (item) =>
        item.id === "dashboard.lowCacheSource" &&
        typeof item.value === "string",
    );
    if (risk != null && risk > 0) {
      return [
        {
          id: "widget.security",
          severity: "risk",
          factKey: "insights.page.widget.widget-broadcast-security",
          factParams: { count: risk },
          evidenceRefs: ["dashboard.securityRisk"],
          allowedActionIds: ["open_security"],
          actionId: "open_security",
        },
      ];
    }
    if (sessions == null) {
      // No dashboard evidence at all → honest empty (no lines).
      return [];
    }
    const candidates: InsightCandidate[] = [
      {
        id: "widget.distill",
        severity: "info",
        factKey: "insights.page.widget.widget-broadcast-distill",
        factParams: { count: sessions ?? 0 },
        evidenceRefs: ["dashboard.sessions"],
        allowedActionIds: ["open_distill"],
        actionId: "open_distill",
      },
    ];
    if (
      lowCacheRate != null &&
      lowCacheRate < LOW_CACHE_THRESHOLD &&
      lowCacheSource != null
    ) {
      candidates.push({
        id: "widget.efficiency",
        severity: "attention",
        factKey: "insights.page.widget.widget-broadcast-efficiency",
        factParams: { name: String(lowCacheSource.value), rate: lowCacheRate },
        evidenceRefs: ["dashboard.lowCacheSource", "dashboard.lowCacheRate"],
        allowedActionIds: ["open_tracker"],
        actionId: "open_tracker",
      });
    }
    return candidates;
  },
};
