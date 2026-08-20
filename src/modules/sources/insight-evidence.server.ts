/**
 * Page-insight evidence adapter for the `sources` surface.
 *
 * Evidence sources (O(1) snapshot reads — never a scan, never a re-probe):
 *  - unified Usage snapshot: per-tool availability + event + malformed counts
 *  - unified Installation snapshot: installed tool ids
 *
 * This adapter deliberately reads the snapshots directly instead of calling
 * `getSourcesQuery()`, whose empty-state path issues a NON-BLOCKING background
 * refresh. An evidence adapter must never trigger a scan.
 *
 * Fact keys are the canonical `insights.page.sources.*` vocabulary declared by
 * `PAGE_RULE_IDS` (M1).
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

function composeSourcesCandidates(
  bundle: InsightEvidenceBundle,
): readonly InsightCandidate[] {
  const connected = metricValue(bundle, "sources.connected");
  const total = metricValue(bundle, "sources.total");
  const malformed = metricValue(bundle, "sources.malformed");
  const candidates: InsightCandidate[] = [];

  if (connected != null && connected > 0) {
    candidates.push({
      id: "sources.connected",
      severity: "info",
      factKey: "insights.page.sources.sources-connected",
      factParams: { count: connected },
      evidenceRefs: ["sources.connected"],
      allowedActionIds: ["open_sources"],
      actionId: "open_sources",
    });
    candidates.push({
      id: "sources.rescan",
      severity: "info",
      factKey: "insights.page.sources.sources-rescan",
      factParams: {},
      evidenceRefs: ["sources.connected"],
      allowedActionIds: ["open_sources"],
      actionId: "open_sources",
    });
    candidates.push({
      id: "sources.local",
      severity: "info",
      factKey: "insights.page.sources.sources-local",
      factParams: {},
      evidenceRefs: ["sources.connected"],
      allowedActionIds: ["open_sources"],
    });
  }

  if (total != null && connected != null && total > 0 && connected < total) {
    const gaps = metricValue(bundle, "sources.gaps");
    candidates.push({
      id: "sources.not-installed",
      severity: "attention",
      factKey: "insights.page.sources.sources-not-installed",
      factParams: { count: gaps ?? total - connected },
      evidenceRefs: ["sources.gaps"],
      allowedActionIds: ["open_sources"],
      actionId: "open_sources",
    });
  }

  if (malformed != null && malformed > 0) {
    candidates.push({
      id: "sources.malformed",
      severity: "attention",
      factKey: "insights.page.sources.sources-malformed",
      factParams: { count: malformed },
      evidenceRefs: ["sources.malformed"],
      allowedActionIds: ["open_sources"],
      actionId: "open_sources",
    });
  }

  if (candidates.length === 0 && total != null && connected === total) {
    candidates.push({
      id: "sources.all-good",
      severity: "info",
      factKey: "insights.page.sources.sources-all-good",
      factParams: { count: total },
      evidenceRefs: ["sources.total"],
      allowedActionIds: ["open_sources"],
      actionId: "open_sources",
    });
  }

  return candidates;
}

export const sourcesInsightAdapter: PageInsightAdapter = {
  surfaceId: "sources",
  adapterVersion: 1,
  async loadEvidence(scope: InsightScope) {
    assertEntityId(scope.entityId);
    const nowMs = Date.now();
    const observedAt = new Date(nowMs).toISOString();

    const { getCompositionRoot } =
      await import("../../app/composition.server.ts");
    const { usageSnapshot, installationSnapshot } = await getCompositionRoot();
    await usageSnapshot.ensureHydrated();
    await installationSnapshot.ensureHydrated();
    const latest = usageSnapshot.readLatest();
    const snapshot = latest.data;

    if (snapshot == null) {
      return emptyBundle("sources", scope, observedAt, true);
    }

    const freshness = freshnessOf(snapshot.generatedAt, nowMs);
    const total = snapshot.sources.length;
    const connected = snapshot.sources.filter(
      (source) => source.events > 0,
    ).length;
    const available = snapshot.sources.filter(
      (source) => source.available,
    ).length;
    const malformed = snapshot.sources.reduce(
      (sum, source) => sum + source.malformedLines,
      0,
    );

    const evidence = [
      metricEvidence("sources.total", total, observedAt, freshness, "count"),
      metricEvidence(
        "sources.connected",
        connected,
        observedAt,
        freshness,
        "count",
      ),
      metricEvidence(
        "sources.available",
        available,
        observedAt,
        freshness,
        "count",
      ),
      metricEvidence(
        "sources.gaps",
        Math.max(0, total - connected),
        observedAt,
        freshness,
        "count",
      ),
      metricEvidence(
        "sources.malformed",
        malformed,
        observedAt,
        freshness,
        "count",
      ),
    ];

    const installations = installationSnapshot.readLatest();
    if (installations.data != null) {
      evidence.push(
        metricEvidence(
          "sources.installed",
          installations.data.facts.filter((fact) => fact.installed).length,
          observedAt,
          freshnessOf(installations.data.generatedAt, nowMs),
          "count",
        ),
      );
    }

    return {
      surfaceId: "sources" as const,
      scope,
      observedAt,
      evidence,
      ...(snapshot.mode !== "real" ? { partial: true } : {}),
    };
  },
  composeCandidates: composeSourcesCandidates,
};
