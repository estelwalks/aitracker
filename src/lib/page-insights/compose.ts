/**
 * Deterministic insight composition for the shared `JarvisInsight` card.
 *
 * These pure functions map real read-model aggregates to structured
 * descriptors (`key` + formatted params); the renderer resolves them through
 * the i18n layer. No LLM, no mock numbers, no conversation content — every
 * figure comes from a server-produced aggregate. Each page calls these on the
 * data it already loaded (no extra network request).
 */
import { formatNumber, formatPercent, formatTokens } from "../i18n/format";
import type { Locale } from "../i18n/locale";
import type { SourcesQuerySummary } from "../../modules/sources/query/presentation/model";
import type { TrackerReadModel } from "../../modules/usage/contracts";
import type { PageInsight } from "./types";

/** `/sources` — insight lines derived from the sources query summary. */
export function composeSourcesInsights(
  summary: SourcesQuerySummary,
  locale: Locale,
): readonly PageInsight[] {
  const { totals } = summary;
  if (totals.toolCount === 0) {
    return [{ id: "sources-empty", key: "insights.sources.empty" }];
  }

  const lines: PageInsight[] = [];
  let hasIssue = false;
  const coverage = totals.toolCount
    ? (totals.connectedCount / totals.toolCount) * 100
    : 0;
  lines.push({
    id: "sources-coverage",
    key: "insights.sources.coverage",
    params: {
      connected: formatNumber(locale, totals.connectedCount),
      total: formatNumber(locale, totals.toolCount),
      rate: formatPercent(locale, coverage),
    },
  });
  if (totals.eventCount > 0) {
    lines.push({
      id: "sources-events",
      key: "insights.sources.events",
      params: { events: formatNumber(locale, totals.eventCount) },
    });
  }
  if (totals.notInstalledCount > 0) {
    hasIssue = true;
    lines.push({
      id: "sources-not-installed",
      key: "insights.sources.notInstalled",
      params: { count: formatNumber(locale, totals.notInstalledCount) },
    });
  }
  if (totals.noLogsCount > 0) {
    hasIssue = true;
    lines.push({
      id: "sources-no-logs",
      key: "insights.sources.noLogs",
      params: { count: formatNumber(locale, totals.noLogsCount) },
    });
  }
  if (totals.malformedCount > 0) {
    hasIssue = true;
    lines.push({
      id: "sources-malformed",
      key: "insights.sources.malformed",
      params: { count: formatNumber(locale, totals.malformedCount) },
    });
  }
  if (!hasIssue) {
    // No actionable issue surfaced — call out the healthy universe.
    lines.push({
      id: "sources-all-good",
      key: "insights.sources.allGood",
      params: { total: formatNumber(locale, totals.toolCount) },
    });
  }
  return lines;
}

/** `/tracker` — insight lines derived from the token burn leaderboard model. */
export function composeTrackerInsights(
  model: TrackerReadModel,
  locale: Locale,
): readonly PageInsight[] {
  const { totals, boards } = model;
  if (totals.tokens <= 0) {
    return [{ id: "tracker-empty", key: "insights.tracker.empty" }];
  }

  const lines: PageInsight[] = [];
  lines.push({
    id: "tracker-burn",
    key: "insights.tracker.burn",
    params: {
      tokens: formatTokens(locale, totals.tokens),
      events: formatNumber(locale, totals.events),
    },
  });

  const allRows = [
    ...boards.skill.rows,
    ...boards.project.rows,
    ...boards.session.rows,
  ];
  if (allRows.length > 0) {
    const wasteLeader = allRows.reduce((best, row) =>
      row.waste > best.waste ? row : best,
    );
    if (wasteLeader.waste >= 40) {
      lines.push({
        id: "tracker-waste-leader",
        key: "insights.tracker.wasteLeader",
        params: {
          name: wasteLeader.name,
          waste: formatPercent(locale, wasteLeader.waste),
        },
      });
    }

    let cacheLowName: string | null = null;
    let cacheLowRate: number | null = null;
    for (const row of allRows) {
      if (row.cacheRate == null) continue;
      if (cacheLowRate == null || row.cacheRate < cacheLowRate) {
        cacheLowName = row.name;
        cacheLowRate = row.cacheRate;
      }
    }
    if (cacheLowName != null && cacheLowRate != null && cacheLowRate < 40) {
      lines.push({
        id: "tracker-cache-low",
        key: "insights.tracker.cacheLow",
        params: {
          name: cacheLowName,
          rate: formatPercent(locale, cacheLowRate),
        },
      });
    }

    const suggestCount = allRows.filter(
      (row) => row.suggestion !== "none",
    ).length;
    if (suggestCount > 0) {
      lines.push({
        id: "tracker-suggest-count",
        key: "insights.tracker.suggestCount",
        params: { count: formatNumber(locale, suggestCount) },
      });
    }

    const burnLeader = allRows.reduce((best, row) =>
      row.tokens > best.tokens ? row : best,
    );
    if (burnLeader.tokens >= 100_000) {
      lines.push({
        id: "tracker-top-burn",
        key: "insights.tracker.topBurn",
        params: {
          name: burnLeader.name,
          tokens: formatTokens(locale, burnLeader.tokens),
        },
      });
    }
  }
  return lines;
}
