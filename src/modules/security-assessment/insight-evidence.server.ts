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
  const scanTime = bundle.evidence.find(
    (item) => item.id === "security.scanTime" && typeof item.value === "string",
  );
  const candidates: InsightCandidate[] = [];

  if (risky != null && risky > 0) {
    candidates.push({
      id: "security.risk-top",
      severity: "risk",
      factKey: "insights.page.security.security-risk-top",
      factParams: { count: risky },
      evidenceRefs: ["security.risky"],
      allowedActionIds: ["open_security"],
      actionId: "open_security",
      mandatory: true,
    });
  }

  if (failed != null && failed > 0) {
    candidates.push({
      id: "security.scan-gap",
      severity: "attention",
      factKey: "insights.page.security.security-scan-gap",
      factParams: { count: failed },
      evidenceRefs: ["security.failed"],
      allowedActionIds: ["open_security"],
      actionId: "open_security",
    });
  }

  if (
    candidates.length === 0 &&
    assessed != null &&
    assessed > 0 &&
    scanTime != null
  ) {
    candidates.push({
      id: "security.last-scan",
      severity: "info",
      factKey: "insights.page.security.security-last-scan",
      factParams: { time: String(scanTime.value) },
      evidenceRefs: ["security.assessed", "security.scanTime"],
      allowedActionIds: ["open_security"],
      actionId: "open_security",
    });
  }

  return candidates;
}

export const securityInsightAdapter: PageInsightAdapter = {
  surfaceId: "security",
  adapterVersion: 1,
  async loadEvidence(scope: InsightScope) {
    assertEntityId(scope.entityId);
    const nowMs = Date.now();
    const observedAt = new Date(nowMs).toISOString();

    const security = await getMonitoringSecuritySummary();
    if (security == null) {
      return emptyBundle("security", scope, observedAt, true);
    }

    const freshness = freshnessOf(security.assessedAt, nowMs);
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
      ],
    };
  },
  composeCandidates: composeSecurityCandidates,
};
