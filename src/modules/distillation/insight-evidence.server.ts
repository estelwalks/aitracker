/**
 * Page-insight evidence adapter for the `distill` surface.
 *
 * Evidence sources (read-only counts/status only — never candidate notes or
 * knowledge bodies):
 *  - distillation application: waiting-candidate count, distilled knowledge count
 *  - server-side daily quota ledger: used/remaining real-model calls
 *
 * Fact keys are the canonical `insights.page.distill.*` vocabulary declared by
 * `PAGE_RULE_IDS` (M1).
 */
import {
  assertEntityId,
  emptyBundle,
  metricEvidence,
  metricValue,
} from "../../app/insights/evidence-util.server.ts";
import type {
  InsightCandidate,
  InsightEvidenceBundle,
  InsightScope,
  PageInsightAdapter,
} from "../insights/page/contracts.ts";

function composeDistillCandidates(
  bundle: InsightEvidenceBundle,
): readonly InsightCandidate[] {
  const waiting = metricValue(bundle, "distill.waiting");
  const quotaRemaining = metricValue(bundle, "distill.quotaRemaining");
  const quotaUsedRate = metricValue(bundle, "distill.quotaUsedRate");
  const candidates: InsightCandidate[] = [];

  if (waiting != null && waiting > 0) {
    candidates.push({
      id: "distill.pending",
      severity: "attention",
      factKey: "insights.page.distill.distill-pending",
      factParams: { count: waiting },
      evidenceRefs: ["distill.waiting"],
      allowedActionIds: ["open_distill"],
      actionId: "open_distill",
    });
  }

  if (quotaRemaining != null && quotaRemaining <= 0) {
    candidates.push({
      id: "distill.quota",
      severity: "risk",
      factKey: "insights.page.distill.distill-quota",
      factParams: { rate: quotaUsedRate ?? 100 },
      evidenceRefs: ["distill.quotaUsedRate"],
      allowedActionIds: ["open_settings"],
      actionId: "open_settings",
    });
  }

  if (candidates.length === 0) {
    candidates.push({
      id: "distill.empty",
      severity: "info",
      factKey: "insights.page.distill.distill-empty",
      factParams: {},
      evidenceRefs: [],
      allowedActionIds: ["open_distill"],
      actionId: "open_distill",
    });
  }
  return candidates;
}

export const distillInsightAdapter: PageInsightAdapter = {
  surfaceId: "distill",
  adapterVersion: 1,
  async loadEvidence(scope: InsightScope) {
    assertEntityId(scope.entityId);
    const nowMs = Date.now();
    const observedAt = new Date(nowMs).toISOString();

    const { getCompositionRoot } =
      await import("../../app/composition.server.ts");
    const root = await getCompositionRoot();

    // Only counts/status are read here; candidate notes and knowledge bodies
    // are deliberately ignored.
    const waiting = await root.distillation.listWaiting();
    const knowledgeCount = await root.distillation.count().catch(() => null);
    const quota = await root.distillQuota.read().catch(() => null);

    const evidence = [
      metricEvidence(
        "distill.waiting",
        waiting.length,
        observedAt,
        "unknown",
        "count",
      ),
    ];
    if (knowledgeCount != null) {
      evidence.push(
        metricEvidence(
          "distill.knowledge",
          knowledgeCount,
          observedAt,
          "unknown",
          "count",
        ),
      );
    }
    if (quota != null) {
      evidence.push(
        metricEvidence(
          "distill.quotaRemaining",
          Math.max(0, quota.limit - quota.used),
          observedAt,
          "unknown",
          "count",
        ),
        metricEvidence(
          "distill.quotaUsedRate",
          quota.limit > 0 ? (quota.used / quota.limit) * 100 : 0,
          observedAt,
          "unknown",
          "percent",
        ),
      );
    }

    const partial = knowledgeCount == null || quota == null;
    return {
      surfaceId: "distill" as const,
      scope,
      observedAt,
      evidence,
      ...(partial ? { partial: true } : {}),
    };
  },
  composeCandidates: composeDistillCandidates,
};
