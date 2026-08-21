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

export function cacheAgeHoursFrom(
  fetchedAt: string,
  nowMs: number,
): number | null {
  const fetchedAtMs = Date.parse(fetchedAt);
  return Number.isFinite(fetchedAtMs)
    ? Math.max(0, Math.floor((nowMs - fetchedAtMs) / 3_600_000))
    : null;
}

function composeMarketCandidates(
  bundle: InsightEvidenceBundle,
): readonly InsightCandidate[] {
  const installed = metricValue(bundle, "market.installed");
  const updates = metricValue(bundle, "market.updates");
  const current = metricValue(bundle, "market.current");
  const cachedTotal = metricValue(bundle, "market.cachedTotal");
  const cacheAgeHours = metricValue(bundle, "market.cacheAgeHours");
  const candidates: InsightCandidate[] = [];
  for (const [id, value, key, ref, param] of [
    [
      "installed",
      installed,
      "market-guide-installs",
      "market.installed",
      "installed",
    ],
    ["updates", updates, "market-guide-updates", "market.updates", "updates"],
    ["current", current, "market-guide-review", "market.current", "current"],
    [
      "catalog",
      cachedTotal,
      "market-guide-cache",
      "market.cachedTotal",
      "total",
    ],
    [
      "cache-age",
      cacheAgeHours,
      "market-guide-install",
      "market.cacheAgeHours",
      "hours",
    ],
  ] as const) {
    if (value == null) continue;
    candidates.push({
      id: `market.${id}`,
      severity: id === "updates" && value > 0 ? "attention" : "info",
      factKey: `insights.page.market.${key}`,
      factParams: { [param]: value },
      evidenceRefs: [ref],
      allowedActionIds: ["open_market"],
      actionId: "open_market",
    });
  }
  return candidates;
}

export const marketInsightAdapter: PageInsightAdapter = {
  surfaceId: "market",
  adapterVersion: 3,
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
    const updates = snapshot.skills.reduce((total, skill) => {
      const hasAvailableUpdate = skill.installations.some(
        (installation) =>
          installation.source?.kind === "market" &&
          installation.updateStatus === "available",
      );
      return total + (hasAvailableUpdate ? 1 : 0);
    }, 0);
    const installed = countInstalledMarketSkills(snapshot.skills);
    const evidence = [
      metricEvidence(
        "market.installed",
        installed,
        observedAt,
        freshness,
        "count",
      ),
      metricEvidence("market.updates", updates, observedAt, freshness, "count"),
      metricEvidence(
        "market.current",
        Math.max(0, installed - updates),
        observedAt,
        freshness,
        "count",
      ),
    ];

    let cacheReadFailed = false;
    const cached = await readMarketCache(DEFAULT_CACHE_KEY).catch(() => {
      cacheReadFailed = true;
      return null;
    });
    if (!cacheReadFailed) {
      evidence.push(
        availabilityEvidence(
          "market.cacheAvailable",
          cached != null,
          observedAt,
        ),
      );
    }
    if (cached != null && cached.pagination.total > 0) {
      const cacheAgeHours = cacheAgeHoursFrom(cached.fetchedAt, nowMs);
      evidence.push(
        metricEvidence(
          "market.cachedTotal",
          cached.pagination.total,
          observedAt,
          freshnessOf(cached.fetchedAt, nowMs),
          "count",
        ),
      );
      if (cacheAgeHours != null) {
        evidence.push(
          metricEvidence(
            "market.cacheAgeHours",
            cacheAgeHours,
            observedAt,
            freshnessOf(cached.fetchedAt, nowMs),
            "count",
          ),
        );
      }
    }

    return {
      surfaceId: "market" as const,
      scope,
      observedAt,
      evidence,
      ...(cached == null || cacheReadFailed ? { partial: true } : {}),
    };
  },
  composeCandidates: composeMarketCandidates,
};
