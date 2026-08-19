/**
 * Page-insight evidence adapter for the `reports` surface.
 *
 * Evidence sources (read-only counts/status — never report bodies):
 *  - reports application: persisted report count and latest generated time
 *
 * Fact keys are the canonical `insights.page.reports.*` vocabulary declared by
 * `PAGE_RULE_IDS` (M1).
 */
import {
  assertEntityId,
  emptyBundle,
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

function composeReportsCandidates(
  bundle: InsightEvidenceBundle,
): readonly InsightCandidate[] {
  const total = metricValue(bundle, "reports.total");
  const latestTime = bundle.evidence.find(
    (item) =>
      item.id === "reports.latestTime" && typeof item.value === "string",
  );

  if (total != null && total > 0 && latestTime != null) {
    return [
      {
        id: "reports.latest",
        severity: "info",
        factKey: "insights.page.reports.reports-latest",
        factParams: { time: String(latestTime.value) },
        evidenceRefs: ["reports.total", "reports.latestTime"],
        allowedActionIds: ["open_reports"],
        actionId: "open_reports",
      },
    ];
  }

  return [
    {
      id: "reports.empty",
      severity: "info",
      factKey: "insights.page.reports.reports-empty",
      factParams: {},
      evidenceRefs: [],
      allowedActionIds: ["open_reports"],
      actionId: "open_reports",
    },
  ];
}

export const reportsInsightAdapter: PageInsightAdapter = {
  surfaceId: "reports",
  adapterVersion: 1,
  async loadEvidence(scope: InsightScope) {
    assertEntityId(scope.entityId);
    const nowMs = Date.now();
    const observedAt = new Date(nowMs).toISOString();

    const { getCompositionRoot } =
      await import("../../app/composition.server.ts");
    const root = await getCompositionRoot();

    const listed = await root.reports.list().catch(() => null);
    const reports = listed?.ok ? listed.value : [];
    const total = reports.length;
    const latest = reports[0];

    const evidence = [
      metricEvidence("reports.total", total, observedAt, "unknown", "count"),
    ];
    if (latest != null) {
      evidence.push(
        statusEvidence(
          "reports.latestTime",
          latest.generatedAt,
          observedAt,
          "unknown",
        ),
      );
    }

    return {
      surfaceId: "reports" as const,
      scope,
      observedAt,
      evidence,
      ...(listed == null ? { partial: true } : {}),
    };
  },
  composeCandidates: composeReportsCandidates,
};
