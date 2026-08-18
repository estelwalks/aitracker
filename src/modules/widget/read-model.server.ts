import type { Locale } from "../../lib/i18n/locale.ts";
import type {
  WidgetPeriodStats,
  WidgetReadModel,
  WidgetStatusReadModel,
} from "./read-model.ts";
import { READ_MODEL_BUDGETS } from "../../lib/read-model/contracts.ts";

/**
 * P4-T4-05/06: server adapter for the compact Widget read model. Reached only
 * through the dynamic imports in `read-model.ts`; never statically imported by
 * the browser graph.
 *
 * Budgets (G4): the status probe must stay ≤ 2 KB and the model ≤ 50 KB
 * serialized. A regression throws so the widget never silently ships a heavy
 * payload (the dashboard read model must be used instead).
 */

function assertJsonBytes(value: unknown, budget: number, label: string): void {
  const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  if (bytes > budget) {
    throw new Error(
      `widget read model ${label} exceeded budget: ${bytes} > ${budget} bytes`,
    );
  }
}

function periodFromWindow(window: {
  readonly totals: { readonly totalTokens: number; readonly events: number };
  readonly sessions: number | null;
  readonly activeTools: number;
  readonly estimatedCostUsd: number | null;
  readonly cacheRate: number | null;
  readonly trend: readonly { date: string; tokens: number }[];
  readonly tools: readonly {
    id: string;
    name: string;
    tokens: number;
    events: number;
    estimatedCostUsd?: number | null;
  }[];
}): WidgetPeriodStats {
  return {
    tokens: window.totals.totalTokens,
    events: window.totals.events,
    sessions: window.sessions,
    activeTools: window.activeTools,
    costUsd: window.estimatedCostUsd,
    cacheRate: window.cacheRate,
    trend: window.trend,
    topTools: window.tools.slice(0, 5).map((tool) => ({
      id: tool.id,
      name: tool.name,
      tokens: tool.tokens,
      events: tool.events,
      costUsd: tool.estimatedCostUsd ?? null,
    })),
  };
}

export async function loadWidgetStatus(
  _locale: Locale,
): Promise<WidgetStatusReadModel> {
  const { getCompositionRoot } =
    await import("../../app/composition.server.ts");
  const { usageSnapshot } = await getCompositionRoot();
  await usageSnapshot.ensureHydrated();
  const latest = usageSnapshot.readLatest();
  const value: WidgetStatusReadModel = {
    revision: latest.revision,
    status: latest.status,
    generatedAt: latest.generatedAt,
  };
  assertJsonBytes(value, READ_MODEL_BUDGETS.widgetStatusBytes, "status");
  return value;
}

export async function loadWidgetReadModel(
  locale: Locale,
): Promise<WidgetReadModel> {
  const { loadDashboardSummaryReadModel } =
    await import("../dashboard/summary-api.server.ts");
  const summary = await loadDashboardSummaryReadModel(locale);
  const value: WidgetReadModel = {
    revision: summary.revision,
    generatedAt: summary.generatedAt,
    hasData: summary.windows.all.hasData,
    today: periodFromWindow(summary.windows.today),
    week: periodFromWindow(summary.windows["7d"]),
    month: periodFromWindow(summary.windows["30d"]),
    total: periodFromWindow(summary.windows.all),
    outputs: {
      distilled: summary.outputAvailability.distillationOutputs.available
        ? summary.outputAvailability.distillationOutputs.count
        : null,
      reports: summary.outputAvailability.dailyReports.available
        ? summary.outputAvailability.dailyReports.count
        : null,
    },
  };
  assertJsonBytes(value, READ_MODEL_BUDGETS.widgetModelBytes, "model");
  return value;
}
