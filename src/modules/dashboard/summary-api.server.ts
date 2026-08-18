import type { Locale } from "../../lib/i18n/locale.ts";
import type {
  DashboardCustomWindowResult,
  DashboardSummaryQueryInput,
  DashboardSummaryReadModel,
} from "./summary-contracts.ts";
import { createDashboardSummaryProjector } from "./application/summary-projector.ts";
import { buildDashboardV2Snapshot } from "./api.server.ts";
import { createDashboardV2HeroView } from "./application/v2.ts";
import { createInsightsApplication } from "../insights/index.ts";
import type { MonitoringStatus } from "../monitoring/contracts.ts";
import { measureReadModel } from "../../platform/observability/measure.ts";
import type { MetricSink } from "../../platform/observability/contracts.ts";

/**
 * P1-T1-04: Server adapter for the compact dashboard summary read model.
 *
 * Query paths build the browser-safe V2 snapshot once (shared with the legacy
 * read model) and project the compact summary from it. The renderer never
 * receives raw events. The optional `shadow` stage compares the compact
 * numbers against the legacy `createDashboardV2View` golden path and logs a
 * sanitized diff; the authoritative response is always the compact model.
 */

const projector = createDashboardSummaryProjector();

// P0-T0-09: observe projection duration + DTO bytes into the composition
// metrics sink (lazily resolved; never blocks the query when unavailable).
let metricSink: MetricSink | null | undefined;
async function getMetricSink(): Promise<MetricSink | undefined> {
  if (metricSink === undefined) {
    try {
      const { getCompositionRoot } =
        await import("../../app/composition.server.ts");
      metricSink = (await getCompositionRoot()).metrics;
    } catch {
      metricSink = null;
    }
  }
  return metricSink ?? undefined;
}

function activeInsightCount(snapshot: {
  generatedAt: string;
  events: number;
  totals: { totalTokens: number };
}): number {
  const insightSnapshot = createInsightsApplication().buildSnapshot({
    usage: {
      observedAt: snapshot.generatedAt,
      events: snapshot.events,
      totalTokens: snapshot.totals.totalTokens,
    },
  });
  return insightSnapshot.insights.filter(
    (insight) => insight.status === "active",
  ).length;
}

export async function loadDashboardSummaryReadModel(
  locale: Locale,
  monitoringOverride?: MonitoringStatus | null,
): Promise<DashboardSummaryReadModel> {
  const { v2, monitoring, error } = await buildDashboardV2Snapshot(locale);
  // P0-T0-09: record projection duration + DTO bytes into the metrics sink.
  const summary = measureReadModel(
    "dashboard.summary",
    () =>
      projector.build({
        snapshot: v2,
        locale,
        status: error == null ? "fresh" : "failed",
      }),
    { metrics: await getMetricSink(), metricPrefix: "read-model" },
  ).value;
  const hero = createDashboardV2HeroView({
    snapshot: v2,
    monitoring: monitoringOverride ?? monitoring,
    activeInsightCount: activeInsightCount({
      generatedAt: v2.generatedAt,
      events: v2.events.length,
      totals: {
        totalTokens: v2.events.reduce(
          (total, event) => total + event.totalTokens,
          0,
        ),
      },
    }),
  });
  return { ...summary, hero, monitoring: monitoringOverride ?? monitoring };
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
/** Maximum supported custom range: 366 days (T1-05). */
const MAX_CUSTOM_RANGE_DAYS = 366;

export async function loadDashboardCustomWindow(
  input: DashboardSummaryQueryInput,
): Promise<DashboardCustomWindowResult> {
  const from = input.from ?? "";
  const to = input.to ?? "";
  if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to))
    throw new TypeError("custom range requires YYYY-MM-DD from/to");
  const fromTime = new Date(`${from}T00:00:00`).getTime();
  const toTime = new Date(`${to}T23:59:59.999`).getTime();
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime))
    throw new TypeError("custom range dates are invalid");
  if (fromTime > toTime) throw new TypeError("custom from must not exceed to");
  const spanDays = (toTime - fromTime) / 86_400_000;
  if (spanDays > MAX_CUSTOM_RANGE_DAYS)
    throw new TypeError(`custom range exceeds ${MAX_CUSTOM_RANGE_DAYS} days`);
  const { v2 } = await buildDashboardV2Snapshot(input.locale);
  return projector.buildCustomWindow({
    snapshot: v2,
    locale: input.locale,
    from,
    to,
    toolId: input.tool ?? null,
  });
}
