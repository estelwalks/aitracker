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

function composeDashboardCandidates(
  bundle: InsightEvidenceBundle,
): readonly InsightCandidate[] {
  const risk = metricValue(bundle, "dashboard.securityRisk");
  const assessed = metricValue(bundle, "dashboard.securityAssessed");
  const events = metricValue(bundle, "dashboard.events");
  const tokens = metricValue(bundle, "dashboard.tokens");
  const sessions = metricValue(bundle, "dashboard.sessions");
  const activeSources = metricValue(bundle, "dashboard.activeSources");
  const averageTokens = metricValue(bundle, "dashboard.averageTokensPerEvent");
  const skillAssets = metricValue(bundle, "dashboard.skillAssets");
  const knowledgeAssets = metricValue(bundle, "dashboard.knowledgeAssets");

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

  if (events != null) {
    candidates.push({
      id: "dashboard.usage",
      severity: "info",
      factKey: "insights.page.dashboard.dashboard-usage",
      factParams: { events },
      evidenceRefs: ["dashboard.events"],
      allowedActionIds: ["open_sessions", "open_distill"],
      actionId: "open_sessions",
    });
  }

  if (tokens != null) {
    candidates.push({
      id: "dashboard.tokens",
      severity: "info",
      factKey: "insights.page.dashboard.dashboard-guide-collection",
      factParams: { tokens },
      evidenceRefs: ["dashboard.tokens"],
      allowedActionIds: ["open_tracker"],
      actionId: "open_tracker",
    });
  }

  if (sessions != null) {
    candidates.push({
      id: "dashboard.sessions",
      severity: "info",
      factKey: "insights.page.dashboard.dashboard-guide-sessions",
      factParams: { count: sessions },
      evidenceRefs: ["dashboard.sessions"],
      allowedActionIds: ["open_sessions"],
      actionId: "open_sessions",
    });
  }

  if (activeSources != null) {
    candidates.push({
      id: "dashboard.active-sources",
      severity: "info",
      factKey: "insights.page.dashboard.dashboard-guide-distill",
      factParams: { count: activeSources },
      evidenceRefs: ["dashboard.activeSources"],
      allowedActionIds: ["open_sources"],
      actionId: "open_sources",
    });
  }

  if (averageTokens != null) {
    candidates.push({
      id: "dashboard.average-tokens",
      severity: "info",
      factKey: "insights.page.dashboard.dashboard-guide-concentration",
      factParams: { average: averageTokens },
      evidenceRefs: ["dashboard.averageTokensPerEvent"],
      allowedActionIds: ["open_tracker"],
      actionId: "open_tracker",
    });
  }

  const topSource = bundle.evidence.find(
    (item) =>
      item.id === "dashboard.topSource" && typeof item.value === "string",
  );
  const topShareRate = metricValue(bundle, "dashboard.topShareRate");
  if (topSource != null && topShareRate != null) {
    candidates.push({
      id: "dashboard.source-concentration",
      severity: "info",
      factKey: "insights.page.dashboard.dashboard-assets",
      factParams: { name: String(topSource.value), rate: topShareRate },
      evidenceRefs: ["dashboard.topSource", "dashboard.topShareRate"],
      allowedActionIds: ["open_sessions"],
      actionId: "open_sessions",
    });
  }

  if (skillAssets != null && knowledgeAssets != null) {
    candidates.push({
      id: "dashboard.asset-summary",
      severity: "info",
      factKey: "insights.page.dashboard.dashboard-watch",
      factParams: { skills: skillAssets, knowledge: knowledgeAssets },
      evidenceRefs: ["dashboard.skillAssets", "dashboard.knowledgeAssets"],
      allowedActionIds: ["open_skills", "open_memory"],
      actionId: "open_skills",
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
  const { usageSnapshot, sessionSnapshot, skillSnapshot } = root;

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
  if (snapshot.events > 0) {
    evidence.push(
      metricEvidence(
        "dashboard.averageTokensPerEvent",
        Math.round(snapshot.totals.totalTokens / snapshot.events),
        observedAt,
        freshness,
        "tokens",
      ),
    );
  }

  const activeSources = snapshot.bySource.filter((source) => source.events > 0);
  evidence.push(
    metricEvidence(
      "dashboard.activeSources",
      activeSources.length,
      observedAt,
      freshness,
      "count",
    ),
  );
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

  await sessionSnapshot.ensureHydrated();
  const sessionsLatest = sessionSnapshot.readLatest();
  if (sessionsLatest.data != null) {
    evidence.push(
      metricEvidence(
        "dashboard.sessions",
        sessionsLatest.data.sessions.length,
        observedAt,
        freshnessOf(sessionsLatest.data.generatedAt, nowMs),
        "count",
      ),
    );
  }

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

  await skillSnapshot.ensureHydrated();
  const skillsLatest = skillSnapshot.readLatest();
  if (skillsLatest.data != null) {
    evidence.push(
      metricEvidence(
        "dashboard.skillAssets",
        skillsLatest.data.skills.length,
        observedAt,
        freshnessOf(skillsLatest.data.generatedAt, nowMs),
        "count",
      ),
    );
  }
  const knowledge = await root.knowledge.list().catch(() => null);
  if (knowledge?.ok) {
    evidence.push(
      metricEvidence(
        "dashboard.knowledgeAssets",
        knowledge.value.length,
        observedAt,
        "unknown",
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
  adapterVersion: 3,
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
        factParams: { count: sessions },
        evidenceRefs: ["dashboard.sessions"],
        allowedActionIds: ["open_distill"],
        actionId: "open_distill",
      },
    ];
    return candidates;
  },
};
