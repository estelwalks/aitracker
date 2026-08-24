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
  const available = metricValue(bundle, "sources.available");
  const gaps = metricValue(bundle, "sources.gaps");
  const malformed = metricValue(bundle, "sources.malformed");
  const installed = metricValue(bundle, "sources.installed");
  const candidates: InsightCandidate[] = [];
  for (const [id, value, key, ref, param] of [
    ["inventory", total, "sources-guide-inventory", "sources.total", "total"],
    [
      "available",
      available,
      "sources-guide-availability",
      "sources.available",
      "available",
    ],
    [
      "connected",
      connected,
      "sources-guide-logs",
      "sources.connected",
      "connected",
    ],
    ["gaps", gaps, "sources-not-installed", "sources.gaps", "count"],
    [
      "malformed",
      malformed,
      "sources-guide-rescan",
      "sources.malformed",
      "malformed",
    ],
    [
      "installed",
      installed,
      "sources-guide-privacy",
      "sources.installed",
      "installed",
    ],
  ] as const) {
    if (value == null) continue;
    candidates.push({
      id: `sources.${id}`,
      severity:
        (id === "gaps" || id === "malformed") && value > 0
          ? "attention"
          : "info",
      factKey: `insights.page.sources.${key}`,
      factParams: { [param]: value },
      evidenceRefs: [ref],
      allowedActionIds: ["open_sources"],
      actionId: "open_sources",
    });
  }

  return candidates;
}

export const sourcesInsightAdapter: PageInsightAdapter = {
  surfaceId: "sources",
  adapterVersion: 3,
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
