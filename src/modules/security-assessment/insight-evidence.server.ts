/**
 * Page-insight evidence adapter for the `security` surface.
 *
 * Evidence sources (read-only aggregate only — never findings, paths, rules or
 * scanner messages):
 *  - monitoring heartbeat's security summary: assessed/clean/risky/failed counts
 *
 * Fact keys are the canonical `insights.page.security.*` vocabulary declared by
 * `PAGE_RULE_IDS` (M1).
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

function composeSecurityCandidates(
  bundle: InsightEvidenceBundle,
): readonly InsightCandidate[] {
  const risky = metricValue(bundle, "security.risky");
  const failed = metricValue(bundle, "security.failed");
  const assessed = metricValue(bundle, "security.assessed");
  const discovered = metricValue(bundle, "security.discovered");
  const clean = metricValue(bundle, "security.clean");
  const coverageRate = metricValue(bundle, "security.coverageRate");
  const scanTime = bundle.evidence.find(
    (item) => item.id === "security.scanTime" && typeof item.value === "string",
  );
  const candidates: InsightCandidate[] = [];

  if (risky != null) {
    candidates.push({
      id: "security.risk-top",
      severity: risky > 0 ? "risk" : "info",
      factKey: "insights.page.security.security-guide-posture",
      factParams: { risky },
      evidenceRefs: ["security.risky"],
      allowedActionIds: ["open_security"],
      actionId: "open_security",
      mandatory: risky > 0,
    });
  }

  if (failed != null) {
    candidates.push({
      id: "security.scan-gap",
      severity: failed > 0 ? "attention" : "info",
      factKey: "insights.page.security.security-guide-failures",
      factParams: { failed },
      evidenceRefs: ["security.failed"],
      allowedActionIds: ["open_security"],
      actionId: "open_security",
    });
  }

  if (assessed != null && discovered != null) {
    candidates.push({
      id: "security.assessment-counts",
      severity: "info",
      factKey: "insights.page.security.security-guide-coverage",
      factParams: { assessed, discovered },
      evidenceRefs: ["security.assessed", "security.discovered"],
      allowedActionIds: ["open_security"],
      actionId: "open_security",
    });
  }

  if (
    coverageRate != null &&
    coverageRate < 100 &&
    assessed != null &&
    assessed > 0
  ) {
    candidates.push({
      id: "security.coverage",
      severity: "info",
      factKey: "insights.page.security.security-scan-coverage",
      factParams: { rate: coverageRate },
      evidenceRefs: ["security.coverageRate"],
      allowedActionIds: ["open_security"],
      actionId: "open_security",
    });
  }

  if (scanTime != null) {
    candidates.push({
      id: "security.last-scan",
      severity: "info",
      factKey: "insights.page.security.security-guide-recency",
      factParams: { time: String(scanTime.value) },
      evidenceRefs: ["security.scanTime"],
      allowedActionIds: ["open_security"],
      actionId: "open_security",
    });
  }

  if (clean != null) {
    candidates.push({
      id: "security.clean",
      severity: "info",
      factKey: "insights.page.security.security-guide-scan",
      factParams: { clean },
      evidenceRefs: ["security.clean"],
      allowedActionIds: ["open_security"],
      actionId: "open_security",
    });
  }

  return candidates;
}

export const securityInsightAdapter: PageInsightAdapter = {
  surfaceId: "security",
  adapterVersion: 3,
  async loadEvidence(scope: InsightScope) {
    assertEntityId(scope.entityId);
    const nowMs = Date.now();
    const observedAt = new Date(nowMs).toISOString();

    const security = await getMonitoringSecuritySummary();
    if (security == null) {
      return emptyBundle("security", scope, observedAt, true);
    }

    const freshness = freshnessOf(security.assessedAt, nowMs);
    const coverageRate =
      security.discoveredAssetCount > 0
        ? Math.round(
            (security.assessedAssetCount / security.discoveredAssetCount) * 100,
          )
        : null;

    return {
      surfaceId: "security" as const,
      scope,
      observedAt,
      evidence: [
        metricEvidence(
          "security.assessed",
          security.assessedAssetCount,
          observedAt,
          freshness,
          "count",
        ),
        metricEvidence(
          "security.discovered",
          security.discoveredAssetCount,
          observedAt,
          freshness,
          "count",
        ),
        metricEvidence(
          "security.risky",
          security.dangerousCount + security.suspiciousCount,
          observedAt,
          freshness,
          "count",
        ),
        metricEvidence(
          "security.clean",
          security.cleanCount,
          observedAt,
          freshness,
          "count",
        ),
        metricEvidence(
          "security.failed",
          security.failedAssetCount,
          observedAt,
          freshness,
          "count",
        ),
        statusEvidence(
          "security.scanTime",
          security.assessedAt,
          observedAt,
          freshness,
        ),
        ...(coverageRate != null
          ? [
              metricEvidence(
                "security.coverageRate",
                coverageRate,
                observedAt,
                freshness,
                "percent",
              ),
            ]
          : []),
      ],
    };
  },
  composeCandidates: composeSecurityCandidates,
};
