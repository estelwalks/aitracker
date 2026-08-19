/**
 * Page-insight evidence adapter for the `memory` surface.
 *
 * Evidence sources (read-only counts/status only — never knowledge bodies):
 *  - knowledge repository: asset count, approved/published count, unsafe count
 *  - freshness is derived from the newest asset `updatedAt`
 *
 * Fact keys are the canonical `insights.page.memory.*` vocabulary declared by
 * `PAGE_RULE_IDS` (M1). The count is carried in evidence for the enhancer; the
 * rule line itself uses the parameter-free `memory-auto` tip (the `memory-total`
 * key's `profiles`/`tasks` split has no backing knowledge-kind mapping yet).
 */
import {
  assertEntityId,
  emptyBundle,
  freshnessOf,
  metricEvidence,
  metricValue,
} from "../../app/insights/evidence-util.server.ts";
import type {
  InsightCandidate,
  InsightEvidenceBundle,
  InsightScope,
  PageInsightAdapter,
} from "../insights/page/contracts.ts";

function composeMemoryCandidates(
  bundle: InsightEvidenceBundle,
): readonly InsightCandidate[] {
  const count = metricValue(bundle, "memory.count");
  if (count != null && count > 0) {
    return [
      {
        id: "memory.auto",
        severity: "info",
        factKey: "insights.page.memory.memory-auto",
        factParams: {},
        evidenceRefs: ["memory.count"],
        allowedActionIds: ["open_memory"],
        actionId: "open_memory",
      },
    ];
  }
  return [
    {
      id: "memory.empty",
      severity: "info",
      factKey: "insights.page.memory.memory-empty",
      factParams: {},
      evidenceRefs: [],
      allowedActionIds: ["open_memory"],
      actionId: "open_memory",
    },
  ];
}

export const memoryInsightAdapter: PageInsightAdapter = {
  surfaceId: "memory",
  adapterVersion: 1,
  async loadEvidence(scope: InsightScope) {
    assertEntityId(scope.entityId);
    const nowMs = Date.now();
    const observedAt = new Date(nowMs).toISOString();

    const { getCompositionRoot } =
      await import("../../app/composition.server.ts");
    const root = await getCompositionRoot();

    const listed = await root.knowledge.list().catch(() => null);
    if (listed == null || !listed.ok) {
      return emptyBundle("memory", scope, observedAt, true);
    }

    const assets = listed.value;
    const count = assets.length;
    const approved = assets.filter(
      (asset) => asset.status === "approved" || asset.status === "published",
    ).length;
    const unsafe = assets.filter(
      (asset) =>
        asset.securityVerdict === "suspicious" ||
        asset.securityVerdict === "dangerous",
    ).length;

    const latestUpdatedAt = assets.reduce<string | null>(
      (best, asset) =>
        best == null || asset.updatedAt > best ? asset.updatedAt : best,
      null,
    );
    const freshness = freshnessOf(latestUpdatedAt, nowMs);

    const evidence = [
      metricEvidence("memory.count", count, observedAt, freshness, "count"),
      metricEvidence(
        "memory.approved",
        approved,
        observedAt,
        freshness,
        "count",
      ),
      metricEvidence("memory.unsafe", unsafe, observedAt, freshness, "count"),
    ];

    return {
      surfaceId: "memory" as const,
      scope,
      observedAt,
      evidence,
    };
  },
  composeCandidates: composeMemoryCandidates,
};
