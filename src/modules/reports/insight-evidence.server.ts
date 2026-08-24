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
  const daily = metricValue(bundle, "reports.daily");
  const weekly = metricValue(bundle, "reports.weekly");
  const draft = metricValue(bundle, "reports.draft");
  const approved = metricValue(bundle, "reports.approved");
  const archived = metricValue(bundle, "reports.archived");
  const latestTime = bundle.evidence.find(
    (item) =>
      item.id === "reports.latestTime" && typeof item.value === "string",
  );

  const candidates: InsightCandidate[] = [];
  if (total != null) {
    candidates.push({
      id: "reports.inventory",
      severity: "info",
      factKey: "insights.page.reports.reports-guide-inventory",
      factParams: { total },
      evidenceRefs: ["reports.total"],
      allowedActionIds: ["open_reports"],
      actionId: "open_reports",
    });
  }
  if (total != null && total > 0 && latestTime != null) {
    candidates.push({
      id: "reports.latest",
      severity: "info",
      factKey: "insights.page.reports.reports-latest",
      factParams: { time: String(latestTime.value) },
      evidenceRefs: ["reports.total", "reports.latestTime"],
      allowedActionIds: ["open_reports"],
      actionId: "open_reports",
    });
  }
  if (daily != null && weekly != null) {
    candidates.push({
      id: "reports.kinds",
      severity: "info",
      factKey: "insights.page.reports.reports-guide-highlights",
      factParams: { daily, weekly },
      evidenceRefs: ["reports.daily", "reports.weekly"],
      allowedActionIds: ["open_reports"],
      actionId: "open_reports",
    });
  }
  for (const [id, value, key, ref] of [
    ["draft", draft, "reports-guide-security", "reports.draft"],
    ["approved", approved, "reports-guide-workflow", "reports.approved"],
    ["archived", archived, "reports-guide-next", "reports.archived"],
  ] as const) {
    if (value == null) continue;
    candidates.push({
      id: `reports.${id}`,
      severity: "info",
      factKey: `insights.page.reports.${key}`,
      factParams: { count: value },
      evidenceRefs: [ref],
      allowedActionIds: ["open_reports"],
      actionId: "open_reports",
    });
  }
  return candidates;
}

export const reportsInsightAdapter: PageInsightAdapter = {
  surfaceId: "reports",
  adapterVersion: 3,
  async loadEvidence(scope: InsightScope) {
    assertEntityId(scope.entityId);
    const nowMs = Date.now();
    const observedAt = new Date(nowMs).toISOString();

    const { getCompositionRoot } =
      await import("../../app/composition.server.ts");
    const root = await getCompositionRoot();

    const listed = await root.reports.list().catch(() => null);
    if (listed == null || !listed.ok) {
      return emptyBundle("reports", scope, observedAt, true);
    }
    const reports = listed.value;
    const total = reports.length;
    const latest = reports[0];
    const countKind = (kind: "daily" | "weekly") =>
      reports.filter((report) => report.kind === kind).length;
    const countStatus = (status: "draft" | "approved" | "archived") =>
      reports.filter((report) => report.status === status).length;

    const evidence = [
      metricEvidence("reports.total", total, observedAt, "unknown", "count"),
      metricEvidence(
        "reports.daily",
        countKind("daily"),
        observedAt,
        "unknown",
        "count",
      ),
      metricEvidence(
        "reports.weekly",
        countKind("weekly"),
        observedAt,
        "unknown",
        "count",
      ),
      metricEvidence(
        "reports.draft",
        countStatus("draft"),
        observedAt,
        "unknown",
        "count",
      ),
      metricEvidence(
        "reports.approved",
        countStatus("approved"),
        observedAt,
        "unknown",
        "count",
      ),
      metricEvidence(
        "reports.archived",
        countStatus("archived"),
        observedAt,
        "unknown",
        "count",
      ),
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
    };
  },
  composeCandidates: composeReportsCandidates,
};
