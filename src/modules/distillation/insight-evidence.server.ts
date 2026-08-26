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
} from "../insights/index.ts";

function composeDistillCandidates(
  bundle: InsightEvidenceBundle,
): readonly InsightCandidate[] {
  const waiting = metricValue(bundle, "distill.waiting");
  const quotaRemaining = metricValue(bundle, "distill.quotaRemaining");
  const quotaUsedRate = metricValue(bundle, "distill.quotaUsedRate");
  const quotaUsed = metricValue(bundle, "distill.quotaUsed");
  const quotaLimit = metricValue(bundle, "distill.quotaLimit");
  const knowledge = metricValue(bundle, "distill.knowledge");
  const candidates: InsightCandidate[] = [];

  if (waiting != null) {
    candidates.push({
      id: "distill.pending",
      severity: waiting > 0 ? "attention" : "info",
      factKey: "insights.page.distill.distill-pending",
      factParams: { count: waiting },
      evidenceRefs: ["distill.waiting"],
      allowedActionIds: ["open_distill"],
      actionId: "open_distill",
    });
  }

  if (quotaUsedRate != null) {
    candidates.push({
      id: "distill.quota",
      severity: quotaRemaining != null && quotaRemaining <= 0 ? "risk" : "info",
      factKey: "insights.page.distill.distill-quota",
      factParams: { rate: quotaUsedRate },
      evidenceRefs: ["distill.quotaUsedRate"],
      allowedActionIds: ["open_settings"],
      actionId: "open_settings",
    });
  }

  if (knowledge != null) {
    candidates.push({
      id: "distill.knowledge",
      severity: "info",
      factKey: "insights.page.distill.distill-guide-outputs",
      factParams: { count: knowledge },
      evidenceRefs: ["distill.knowledge"],
      allowedActionIds: ["open_distill"],
      actionId: "open_distill",
    });
  }
  if (quotaRemaining != null) {
    candidates.push({
      id: "distill.remaining",
      severity: "info",
      factKey: "insights.page.distill.distill-guide-quota",
      factParams: { count: quotaRemaining },
      evidenceRefs: ["distill.quotaRemaining"],
      allowedActionIds: ["open_settings"],
      actionId: "open_settings",
    });
  }
  if (quotaUsed != null && quotaLimit != null) {
    candidates.push({
      id: "distill.ledger",
      severity: "info",
      factKey: "insights.page.distill.distill-guide-intake",
      factParams: { used: quotaUsed, limit: quotaLimit },
      evidenceRefs: ["distill.quotaUsed", "distill.quotaLimit"],
      allowedActionIds: ["open_settings"],
      actionId: "open_settings",
    });
  }
  return candidates;
}

export const distillInsightAdapter: PageInsightAdapter = {
  surfaceId: "distill",
  adapterVersion: 3,
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
          "distill.quotaUsed",
          quota.used,
          observedAt,
          "unknown",
          "count",
        ),
        metricEvidence(
          "distill.quotaLimit",
          quota.limit,
          observedAt,
          "unknown",
          "count",
        ),
      );
      if (quota.limit > 0) {
        evidence.push(
          metricEvidence(
            "distill.quotaUsedRate",
            (quota.used / quota.limit) * 100,
            observedAt,
            "unknown",
            "percent",
          ),
        );
      }
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
