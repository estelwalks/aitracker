/**
 * Page-insight evidence adapters for the `dashboard` and `widget` surfaces.
 *
 * Evidence sources (all O(1) read models, never a scan):
 *  - unified Usage snapshot (event count + total tokens)
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
      evidenceRefs: ["dashboard.events", "dashboard.tokens", "dashboard.sessions"],
      allowedActionIds: ["open_sessions", "open_distill"],
      actionId: "open_sessions",
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
  adapterVersion: 1,
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
    return [
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
  },
};
