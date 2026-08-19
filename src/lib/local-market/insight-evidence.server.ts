/**
 * Page-insight evidence adapter for the `market` surface.
 *
 * Evidence sources (local, O(1), never a network request):
 *  - unified Skill snapshot: locally installed market-managed skill count
 *  - SQLite http-cache: cached market listing total (best-effort, may be absent)
 *
 * Fact keys are the canonical `insights.page.market.*` vocabulary declared by
 * `PAGE_RULE_IDS` (M1).
 */
import {
  assertEntityId,
  availabilityEvidence,
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
} from "../../modules/insights/page/contracts.ts";
import { countInstalledMarketSkills } from "./api.server.ts";
import { marketCacheKey, readMarketCache } from "./cache.server.ts";

const DEFAULT_CACHE_KEY = marketCacheKey(1, 12, "", "downloads", "");

function composeMarketCandidates(
  bundle: InsightEvidenceBundle,
): readonly InsightCandidate[] {
  const installed = metricValue(bundle, "market.installed");
  if (installed != null && installed > 0) {
    return [
      {
        id: "market.installed",
        severity: "info",
        factKey: "insights.page.market.market-installed",
        factParams: { count: installed },
        evidenceRefs: ["market.installed"],
        allowedActionIds: ["open_market"],
        actionId: "open_market",
      },
    ];
  }
  return [
    {
      id: "market.scan-first",
      severity: "info",
      factKey: "insights.page.market.market-scan-first",
      factParams: {},
      evidenceRefs: [],
      allowedActionIds: ["open_market"],
      actionId: "open_market",
    },
  ];
}

export const marketInsightAdapter: PageInsightAdapter = {
  surfaceId: "market",
  adapterVersion: 1,
  async loadEvidence(scope: InsightScope) {
    assertEntityId(scope.entityId);
    const nowMs = Date.now();
    const observedAt = new Date(nowMs).toISOString();

    const { getCompositionRoot } =
      await import("../../app/composition.server.ts");
    const { skillSnapshot } = await getCompositionRoot();
    await skillSnapshot.ensureHydrated();
    const latest = skillSnapshot.readLatest();
    const snapshot = latest.data;

    if (snapshot == null) {
      return emptyBundle("market", scope, observedAt, true);
    }

    const freshness = freshnessOf(snapshot.generatedAt, nowMs);
    const evidence = [
      metricEvidence(
        "market.installed",
        countInstalledMarketSkills(snapshot.skills),
        observedAt,
        freshness,
        "count",
      ),
    ];

    const cached = await readMarketCache(DEFAULT_CACHE_KEY).catch(() => null);
    evidence.push(
      availabilityEvidence("market.cacheAvailable", cached != null, observedAt),
    );
    if (cached != null && cached.pagination.total > 0) {
      evidence.push(
        metricEvidence(
          "market.cachedTotal",
          cached.pagination.total,
          observedAt,
          freshnessOf(cached.fetchedAt, nowMs),
          "count",
        ),
      );
    }

    return {
      surfaceId: "market" as const,
      scope,
      observedAt,
      evidence,
      ...(cached == null ? { partial: true } : {}),
    };
  },
  composeCandidates: composeMarketCandidates,
};
