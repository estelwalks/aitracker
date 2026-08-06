import { formatMoney as i18nFormatMoney } from "../i18n/format";
import type { Locale } from "../i18n/locale";
import type {
  LocalTokenCounts,
  LocalUsageEvent,
  LocalUsageSource,
  LocalUsageTotals,
} from "../local-usage";
import type { UsagePeriod } from "../local-usage/presentation";
import type { PricingSnapshot, RuntimeModelPrice } from "./types";

export type { PricingSnapshot, RuntimeModelPrice } from "./types";
export type {
  ToolPricingPolicy,
  PricingConfidence,
  PricingResolution,
} from "./contracts";
export { PRICING_RULES_VERSION } from "./registry.ts";

import type { Currency } from "../i18n/locale";
export type { Currency } from "../i18n/locale";
export type UsageDimension = "source" | "model" | "project" | "tokenType";
export type TokenTypeKey =
  "input" | "output" | "cacheRead" | "cacheWrite" | "reasoning";

import { resolvePrice } from "./resolve.ts";
import { getDefaultPricingRegistry } from "./registry.ts";
import { getToolPricingPolicy } from "./tool-policy.ts";

/**
 * Built-in baseline exchange rates (offline fallback). These are static
 * approximations — the UI labels their source as "fallback" and never presents
 * them as live prices (docs/plan v1.2 汇率与离线).
 */
export const BUILTIN_RATES: Record<Currency, number> = {
  CNY: 7.2,
  JPY: 145,
  KRW: 1350,
  USD: 1,
};

export const DEFAULT_USD_TO_CNY = BUILTIN_RATES.CNY;
let activePricingSnapshot: PricingSnapshot | null = null;
/**
 * Apply a pricing snapshot. Model prices now come from the offline rule-pack
 * registry (resolve.ts); the snapshot only carries exchange rates for display
 * currency conversion.
 */
export function applyPricingSnapshot(snapshot: PricingSnapshot | null): void {
  activePricingSnapshot = snapshot;
}

export function currentUsdToCny(): number {
  return activePricingSnapshot?.usdToCny ?? DEFAULT_USD_TO_CNY;
}

/**
 * The exchange rate for a display currency. Prefers the latest pricing
 * snapshot's rates (single shared snapshot per session), then the built-in
 * baseline. USD is always 1.
 */
export function currentRate(currency: Currency): number {
  if (currency === "USD") return 1;
  const fromSnapshot = activePricingSnapshot?.exchangeRates?.[currency];
  return typeof fromSnapshot === "number" && Number.isFinite(fromSnapshot)
    ? fromSnapshot
    : BUILTIN_RATES[currency];
}

export interface CostEstimate {
  knownUsd: number;
  cacheSavingsUsd: number;
  pricedEvents: number;
  unknownEvents: number;
  unknownModels: string[];
  complete: boolean;
}

export interface PricedUsageRow extends LocalUsageTotals {
  key: string;
  cost: CostEstimate;
}

const EMPTY_COUNTS: LocalTokenCounts = {
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheCreationInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 0,
};

const NANO_PER_USD = 1_000_000_000n;

/** Convert nanoUSD (bigint) to a USD `number` for the display-layer CostEstimate. */
function nanoToUsd(nano: bigint): number {
  return Number(nano) / Number(NANO_PER_USD);
}

/**
 * Estimate the cost of a single usage event via the offline source-aware pricing
 * registry (docs §5). Model prices come from the built-in rule packs; the
 * exchange-rate snapshot only affects display currency, not the USD amount.
 * Unknown / unpriced / not-billable models map to the legacy "unknown" cost
 * (complete: false) so the UI shows "price unknown" rather than $0.
 */
export function estimateEventCost(event: LocalUsageEvent): CostEstimate {
  const registry = getDefaultPricingRegistry();
  const policy = getToolPricingPolicy(event.source);
  const resolution = resolvePrice(
    registry,
    {
      toolId: event.source,
      rawModel: event.model,
      occurredAt: event.timestamp,
      tokens: {
        input: BigInt(event.inputTokens),
        output: BigInt(event.outputTokens),
        cacheRead: BigInt(event.cachedInputTokens),
        cacheWrite: BigInt(event.cacheCreationInputTokens),
        reasoningOutput: BigInt(event.reasoningOutputTokens),
      },
    },
    policy,
  );

  if (
    resolution.confidence === "exact" &&
    resolution.knownUsdNano !== undefined
  ) {
    return {
      knownUsd: nanoToUsd(resolution.knownUsdNano),
      cacheSavingsUsd:
        resolution.cacheSavingsUsdNano !== undefined
          ? nanoToUsd(resolution.cacheSavingsUsdNano)
          : 0,
      pricedEvents: 1,
      unknownEvents: 0,
      unknownModels: [],
      complete: true,
    };
  }
  return unknownCost(event.model);
}

export function estimateUsageCost(events: LocalUsageEvent[]): CostEstimate {
  return events.reduce<CostEstimate>(
    (total, event) => mergeCosts(total, estimateEventCost(event)),
    emptyCost(),
  );
}

export function aggregatePricedUsage(
  events: LocalUsageEvent[],
  dimension: UsageDimension,
): PricedUsageRow[] {
  const rows = new Map<
    string,
    { events: LocalUsageEvent[]; totals: LocalUsageTotals }
  >();

  for (const event of events) {
    if (dimension === "tokenType") {
      addTokenTypeRows(rows, event);
      continue;
    }
    const key =
      dimension === "source"
        ? event.source
        : dimension === "model"
          ? event.model
          : event.project;
    addEventToRow(rows, key, event);
  }

  return [...rows.entries()]
    .map(([key, row]) => ({
      key,
      ...row.totals,
      cost: estimateUsageCost(row.events),
    }))
    .sort(
      (left, right) =>
        right.totalTokens - left.totalTokens ||
        left.key.localeCompare(right.key),
    );
}

export function filterEventsByPeriod(
  events: LocalUsageEvent[],
  period: UsagePeriod,
  customFrom?: string,
  customTo?: string,
  now = new Date(),
): LocalUsageEvent[] {
  const today = localDateKey(now);
  let from = today;
  let to = today;

  if (period === "week") {
    const day = now.getDay();
    from = localDateKey(addDays(now, -(day === 0 ? 6 : day - 1)));
  }
  if (period === "7d") from = localDateKey(addDays(now, -6));
  if (period === "30d") from = localDateKey(addDays(now, -29));
  if (period === "month") {
    from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  }
  if (period === "custom") {
    from = customFrom || today;
    to = customTo || today;
  }

  return events.filter((event) => {
    const date = localDateKey(new Date(event.timestamp));
    return date >= from && date <= to;
  });
}

export function totalsFromEvents(events: LocalUsageEvent[]): LocalUsageTotals {
  return events.reduce<LocalUsageTotals>(
    (totals, event) => ({
      events: totals.events + 1,
      inputTokens: totals.inputTokens + event.inputTokens,
      cachedInputTokens: totals.cachedInputTokens + event.cachedInputTokens,
      cacheCreationInputTokens:
        totals.cacheCreationInputTokens + event.cacheCreationInputTokens,
      outputTokens: totals.outputTokens + event.outputTokens,
      reasoningOutputTokens:
        totals.reasoningOutputTokens + event.reasoningOutputTokens,
      totalTokens: totals.totalTokens + event.totalTokens,
    }),
    { events: 0, ...EMPTY_COUNTS },
  );
}

/** Convert a USD amount to a display currency. USD passes through unchanged. */
export function convertUsd(value: number, currency: Currency, rate?: number) {
  return currency === "USD" ? value : value * (rate ?? currentRate(currency));
}

/**
 * Format a cost in its display currency (converting USD first). The currency
 * never changes with the UI language; `locale` only affects number grouping
 * and the currency symbol presentation. `rate` overrides the snapshot/built-in
 * rate (callers pass an explicit rate to pin a single snapshot).
 */
export function formatMoney(
  locale: Locale,
  valueUsd: number,
  currency: Currency,
  rate?: number,
): string {
  return i18nFormatMoney(
    locale,
    convertUsd(valueUsd, currency, rate),
    currency,
  );
}

/**
 * Format a cost estimate as a bare amount, or null when nothing is priced.
 * The "price unknown" / "(partially unknown)" wording lives in the message
 * catalogs (pricing.unknown / pricing.partialUnknown) and is composed with
 * `t()` at the display boundary — never concatenated in lib code.
 */
export function formatCostAmount(
  locale: Locale,
  cost: CostEstimate,
  currency: Currency,
  rate?: number,
): string | null {
  if (cost.pricedEvents === 0 && cost.unknownEvents > 0) return null;
  return formatMoney(locale, cost.knownUsd, currency, rate);
}

export function sourceName(source: LocalUsageSource | string) {
  return source === "claude-code"
    ? "Claude Code"
    : source === "codex"
      ? "Codex"
      : source;
}

function perMillion(tokens: number, rate: number) {
  return (tokens / 1_000_000) * rate;
}

function emptyCost(): CostEstimate {
  return {
    knownUsd: 0,
    cacheSavingsUsd: 0,
    pricedEvents: 0,
    unknownEvents: 0,
    unknownModels: [],
    complete: true,
  };
}

function unknownCost(model: string): CostEstimate {
  return {
    ...emptyCost(),
    unknownEvents: 1,
    unknownModels: [model],
    complete: false,
  };
}

function mergeCosts(left: CostEstimate, right: CostEstimate): CostEstimate {
  return {
    knownUsd: left.knownUsd + right.knownUsd,
    cacheSavingsUsd: left.cacheSavingsUsd + right.cacheSavingsUsd,
    pricedEvents: left.pricedEvents + right.pricedEvents,
    unknownEvents: left.unknownEvents + right.unknownEvents,
    unknownModels: [
      ...new Set([...left.unknownModels, ...right.unknownModels]),
    ].sort(),
    complete: left.complete && right.complete,
  };
}

function emptyTotals(): LocalUsageTotals {
  return { events: 0, ...EMPTY_COUNTS };
}

function addEventToRow(
  rows: Map<string, { events: LocalUsageEvent[]; totals: LocalUsageTotals }>,
  key: string,
  event: LocalUsageEvent,
) {
  const row = rows.get(key) ?? { events: [], totals: emptyTotals() };
  row.events.push(event);
  row.totals.events += 1;
  row.totals.inputTokens += event.inputTokens;
  row.totals.cachedInputTokens += event.cachedInputTokens;
  row.totals.cacheCreationInputTokens += event.cacheCreationInputTokens;
  row.totals.outputTokens += event.outputTokens;
  row.totals.reasoningOutputTokens += event.reasoningOutputTokens;
  row.totals.totalTokens += event.totalTokens;
  rows.set(key, row);
}

function addTokenTypeRows(
  rows: Map<string, { events: LocalUsageEvent[]; totals: LocalUsageTotals }>,
  event: LocalUsageEvent,
) {
  const tokens: [TokenTypeKey, number][] = [
    ["input", event.inputTokens],
    ["output", event.outputTokens],
    ["cacheRead", event.cachedInputTokens],
    ["cacheWrite", event.cacheCreationInputTokens],
    ["reasoning", event.reasoningOutputTokens],
  ];

  for (const [key, value] of tokens) {
    if (value <= 0) continue;
    const tokenEvent: LocalUsageEvent = {
      ...event,
      inputTokens: key === "input" ? value : 0,
      outputTokens: key === "output" ? value : 0,
      cachedInputTokens: key === "cacheRead" ? value : 0,
      cacheCreationInputTokens: key === "cacheWrite" ? value : 0,
      reasoningOutputTokens: key === "reasoning" ? value : 0,
      totalTokens: value,
    };
    addEventToRow(rows, key, tokenEvent);
  }
}

function addDays(value: Date, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function localDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
