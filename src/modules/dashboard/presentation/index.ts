import type { DashboardModuleContract } from "../contracts";
import type {
  LocalUsageEvent,
  LocalUsageTotals,
} from "../../../lib/local-usage/types.ts";
import {
  aggregateEventsByTime,
  cacheRate,
  resolveUsageRange,
  shareOf,
} from "../../../lib/local-usage/presentation.ts";
import type { UsagePeriod } from "../../../lib/local-usage/presentation.ts";
import type { CostEstimate } from "../../../lib/pricing";
import type { BoundFormatters } from "../../../lib/i18n/format.ts";
import type { Currency } from "../../../lib/i18n/locale.ts";
import {
  aggregatePricedUsage,
  convertUsd,
  estimateEventCost,
} from "../../../lib/pricing";
import type { ExportRow } from "../../../lib/export";
import { sourceLabel } from "../../../lib/local-usage/presentation.ts";
export type DashboardViewModel = DashboardModuleContract;

export interface DashboardPosterData {
  readonly periodLabel: string;
  readonly rangeLabel: string;
  readonly tokens: number;
  readonly costLabel: string;
  readonly savedLabel: string;
  readonly hitRate: number;
  readonly trend: number[];
  readonly providers: { name: string; value: number }[];
  readonly models: { name: string; tokens: string; pct: number }[];
  readonly unknownPriceModels: number;
}

export function buildDashboardPosterData(input: {
  readonly events: readonly LocalUsageEvent[];
  readonly totals: LocalUsageTotals;
  readonly cost: CostEstimate;
  readonly period: UsagePeriod;
  readonly periodLabel: string;
  readonly from: string;
  readonly to: string;
  readonly format: BoundFormatters & {
    formatUsd: (amountUsd: number) => string;
  };
}): DashboardPosterData {
  const range = resolveUsageRange(input.period, input.from, input.to);
  const rangeLabel =
    range.valid && range.from && range.to
      ? `${input.format.formatDate(new Date(`${range.from}T00:00:00`))} ~ ${input.format.formatDate(new Date(`${range.to}T00:00:00`))}`
      : "";
  const trend = aggregateEventsByTime([...input.events], "day").map(
    (bucket) => bucket.totalTokens,
  );
  const providers = aggregatePricedUsage([...input.events], "source")
    .filter((row) => row.totalTokens > 0)
    .map((row) => ({ name: sourceLabel(row.key), value: row.totalTokens }));
  const modelRows = aggregatePricedUsage([...input.events], "model").filter(
    (row) => row.totalTokens > 0,
  );
  const grandTotal = modelRows.reduce((sum, row) => sum + row.totalTokens, 0);
  const models = modelRows.slice(0, 3).map((row) => ({
    name: row.key,
    tokens: input.format.formatTokens(row.totalTokens),
    pct: shareOf(row.totalTokens, grandTotal),
  }));
  return {
    periodLabel: input.periodLabel,
    rangeLabel,
    tokens: input.totals.totalTokens,
    costLabel: input.format.formatUsd(
      input.cost.knownUsd + input.cost.estimatedUsd,
    ),
    savedLabel: input.format.formatUsd(input.cost.cacheSavingsUsd),
    hitRate: cacheRate(input.totals),
    trend,
    providers,
    models,
    unknownPriceModels: input.cost.unknownModels.length,
  };
}

export function buildDashboardExport(input: {
  readonly events: readonly LocalUsageEvent[];
  readonly displayCurrency: Currency;
  readonly rates?: {
    readonly rates: Record<string, number>;
    readonly date?: string;
  };
}): { rows: ExportRow[]; sourceLabels: Record<string, string> } {
  const rate = input.rates?.rates[input.displayCurrency] ?? 1;
  const rateDate = input.rates?.date ?? "";
  const sourceLabels: Record<string, string> = {};
  const rows = input.events.map((event) => {
    const cost = estimateEventCost(event);
    const exportable = cost.unknownEvents === 0;
    const amountUsd = cost.knownUsd + cost.estimatedUsd;
    if (!(event.source in sourceLabels))
      sourceLabels[event.source] = sourceLabel(event.source);
    return {
      timestamp: event.timestamp,
      source: event.source,
      model: event.model,
      project: event.project,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      cachedInputTokens: event.cachedInputTokens,
      cacheCreationInputTokens: event.cacheCreationInputTokens,
      reasoningOutputTokens: event.reasoningOutputTokens,
      ...(exportable
        ? {
            cost: amountUsd,
            costDisplay: convertUsd(amountUsd, input.displayCurrency, rate),
            currency: input.displayCurrency,
            rate,
            rateDate,
          }
        : {}),
    } satisfies ExportRow;
  });
  return { rows, sourceLabels };
}

export type { DashboardModuleContract } from "../contracts";
