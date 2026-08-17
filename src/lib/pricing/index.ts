import { formatMoney as i18nFormatMoney } from "../i18n/format";
import type { Locale } from "../i18n/locale";
import type {
  LocalTokenCounts,
  LocalUsageEvent,
  LocalUsageSource,
  LocalUsageTotals,
} from "../local-usage";
import type { UsagePeriod } from "../local-usage/presentation";
import type { PricingSnapshot } from "./types";

export type { PricingSnapshot } from "./types";
export type { PricingConfidence, PricingResolution } from "./contracts";
export { PRICING_RULES_VERSION } from "./registry.ts";

import type { Currency } from "../i18n/locale";
export type { Currency } from "../i18n/locale";
export type UsageDimension = "source" | "model" | "project" | "tokenType";
export type TokenTypeKey =
  "input" | "output" | "cacheRead" | "cacheWrite" | "reasoning";

import { resolvePrice } from "./resolve.ts";
import { getDefaultPricingRegistry } from "./registry.ts";
import {
  getTool,
  getToolDisplay,
  getUsagePlan,
} from "../tool-registry/registry.ts";

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

/**
 * Aggregated cost estimate preserving the four pricing states (audit P1-1):
 * - `knownUsd`/`pricedEvents`: `exact` resolutions (route evidence + rate).
 * - `estimatedUsd`/`estimatedEvents`: `estimated` resolutions (reference-route
 *   prices without route evidence, or the packaged generic estimate). Kept as
 *   a separate subtotal - never disguised as an exact/official bill.
 * - `unknownEvents`/`unknownModels`: `unpriced` resolutions (price genuinely
 *   unknown). Unknown models are never shown as $0.
 * - `not-billable` events contribute nothing to either subtotal and are not
 *   counted as unknown (explicitly not charged); `complete` stays true.
 */
export interface CostEstimate {
  knownUsd: number;
  estimatedUsd: number;
  cacheSavingsUsd: number;
  pricedEvents: number;
  estimatedEvents: number;
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
 * Estimate the cost of a single usage event via the offline route-first pricing
 * registry (docs §5, audit P1-1). Model prices come from the built-in rule
 * packs; the exchange-rate snapshot only affects display currency, not the USD
 * amount. The four resolution states have distinct aggregates:
 * - `exact` -> `knownUsd` + `pricedEvents` (complete).
 * - `estimated` -> `estimatedUsd` + `estimatedEvents` (reference-route prices
 *   without route evidence, or the packaged generic estimate). Never disguised
 *   as an official cost.
 * - `unpriced` -> `unknownEvents` + `unknownModels` (price unknown; never $0).
 * - `not-billable` -> counted nowhere (explicitly not charged; complete).
 *
 * Evidence: `LocalUsageEvent` carries no endpoint/provider fields today, so
 * local events always resolve via the reference-route path (estimated).
 *
 * Memoization: the result is cached per event object. Events are immutable
 * parsed records and both registries (pricing + tool) are compiled once per
 * process and never reset at runtime (the `__reset*` hooks are unused by tests
 * and app code), so the function is effectively pure. A single dashboard
 * render re-aggregates the same snapshot across source/model/project/tokenType
 * plus the grand total — caching turns those repeated passes into O(1) lookups
 * (~4× fewer rule-matching calls on a 10万-event snapshot, NFR-001).
 */
const eventCostCache = new WeakMap<LocalUsageEvent, CostEstimate>();

export function estimateEventCost(event: LocalUsageEvent): CostEstimate {
  const cached = eventCostCache.get(event);
  if (cached) return cached;

  const registry = getDefaultPricingRegistry();
  const observation = getTool(event.source)?.modelObservation ?? null;
  const usagePlan = getUsagePlan(event.source);
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
    {
      // Usage-capable tools fall back to the packaged generic estimate
      // (api-generic-v1, confidence "estimated"); tools without a usage plan
      // are never billed. Fallback behavior is JSON-only - no env override.
      notBillable: usagePlan === null,
      fallbackProfileId: "api-generic-v1",
      reasoningIncludedInOutput:
        observation?.tokenSemantics?.reasoningIncludedInOutput ?? true,
    },
  );

  let cost: CostEstimate;
  switch (resolution.confidence) {
    case "exact": {
      const known = resolution.knownUsdNano ?? 0n;
      cost = {
        knownUsd: nanoToUsd(known),
        estimatedUsd: 0,
        cacheSavingsUsd:
          resolution.cacheSavingsUsdNano !== undefined
            ? nanoToUsd(resolution.cacheSavingsUsdNano)
            : 0,
        pricedEvents: 1,
        estimatedEvents: 0,
        unknownEvents: 0,
        unknownModels: [],
        complete: true,
      };
      break;
    }
    case "estimated": {
      const estimated = resolution.knownUsdNano ?? 0n;
      cost = {
        knownUsd: 0,
        estimatedUsd: nanoToUsd(estimated),
        cacheSavingsUsd:
          resolution.cacheSavingsUsdNano !== undefined
            ? nanoToUsd(resolution.cacheSavingsUsdNano)
            : 0,
        pricedEvents: 0,
        estimatedEvents: 1,
        unknownEvents: 0,
        unknownModels: [],
        complete: true,
      };
      break;
    }
    case "not-billable":
      // Explicitly not charged: no cost, no unknown (complete answer).
      cost = emptyCost();
      break;
    case "unpriced":
      cost = unknownCost(event.model);
      break;
  }
  eventCostCache.set(event, cost);
  return cost;
}

export function estimateUsageCost(events: LocalUsageEvent[]): CostEstimate {
  return events.reduce<CostEstimate>(
    (total, event) => mergeCosts(total, estimateEventCost(event)),
    emptyCost(),
  );
}

/**
 * Per-(source, model, day) cost bucket for the tokenType dimension.
 *
 * A tokenType row's cost is a linear function of each event's token counts for
 * a fixed resolution (price lookups are day-granular: `occurredAt` is sliced
 * to its date in resolve.ts). Bucketing events by (source, model, day) lets us
 * run `estimateEventCost` once per bucket on the aggregated tokens and scale
 * the result by the bucket's event count — identical numbers, without
 * materializing up to 5 full event copies per input event (10万事件 → ~50万
 * objects).
 */
interface TokenCountFields {
  inputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

interface TokenTypeBucket extends TokenCountFields {
  source: LocalUsageSource;
  model: string;
  timestamp: string;
  count: number;
}

function emptyBucket(
  source: LocalUsageSource,
  model: string,
  timestamp: string,
): TokenTypeBucket {
  return {
    source,
    model,
    timestamp,
    count: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  };
}

/**
 * Scale the event-count fields of a bucket's aggregated cost estimate.
 *
 * The aggregated synthetic event already carries the bucket's summed token
 * counts, so the USD fields need no scaling (calculate.ts is purely linear in
 * tokens — no fixed per-event fees). Only the per-event counters
 * (`pricedEvents`/`estimatedEvents`/`unknownEvents`) must be multiplied by the
 * bucket's event count; `complete` and `unknownModels` are identical for every
 * event in the bucket because they share source/model/day.
 */
function scaleCostCounts(cost: CostEstimate, factor: number): CostEstimate {
  return {
    knownUsd: cost.knownUsd,
    estimatedUsd: cost.estimatedUsd,
    cacheSavingsUsd: cost.cacheSavingsUsd,
    pricedEvents: cost.pricedEvents * factor,
    estimatedEvents: cost.estimatedEvents * factor,
    unknownEvents: cost.unknownEvents * factor,
    unknownModels: cost.unknownModels,
    complete: cost.complete,
  };
}

const TOKEN_TYPE_SOURCES: readonly [TokenTypeKey, keyof LocalTokenCounts][] = [
  ["input", "inputTokens"],
  ["output", "outputTokens"],
  ["cacheRead", "cachedInputTokens"],
  ["cacheWrite", "cacheCreationInputTokens"],
  ["reasoning", "reasoningOutputTokens"],
] as const;

function addTokenCounts(
  target: TokenCountFields,
  key: TokenTypeKey,
  value: number,
): void {
  switch (key) {
    case "input":
      target.inputTokens += value;
      break;
    case "output":
      target.outputTokens += value;
      break;
    case "cacheRead":
      target.cachedInputTokens += value;
      break;
    case "cacheWrite":
      target.cacheCreationInputTokens += value;
      break;
    case "reasoning":
      target.reasoningOutputTokens += value;
      break;
  }
  target.totalTokens += value;
}

function aggregateTokenTypeRows(events: LocalUsageEvent[]): PricedUsageRow[] {
  const rows = new Map<
    TokenTypeKey,
    { totals: LocalUsageTotals; buckets: Map<string, TokenTypeBucket> }
  >();

  for (const event of events) {
    for (const [key, field] of TOKEN_TYPE_SOURCES) {
      const value = event[field];
      if (value <= 0) continue;
      let row = rows.get(key);
      if (!row) {
        row = { totals: emptyTotals(), buckets: new Map() };
        rows.set(key, row);
      }
      // A tokenType row aggregates only its own token type (the old
      // implementation pushed single-type synthetic events; totals here mirror
      // that: `totalTokens` is the sum of this type's tokens, not the sum of
      // the source events' total tokens).
      row.totals.events += 1;
      addTokenCounts(row.totals, key, value);

      const bucketKey = `${event.source}\u0000${event.model}\u0000${localDateKey(
        new Date(event.timestamp),
      )}`;
      const bucket =
        row.buckets.get(bucketKey) ??
        emptyBucket(event.source, event.model, event.timestamp);
      bucket.count += 1;
      addTokenCounts(bucket, key, value);
      row.buckets.set(bucketKey, bucket);
    }
  }

  return [...rows.entries()]
    .map(([key, row]) => {
      let cost = emptyCost();
      for (const bucket of row.buckets.values()) {
        const synthetic: LocalUsageEvent = {
          source: bucket.source,
          timestamp: bucket.timestamp,
          model: bucket.model,
          project: "",
          inputTokens: key === "input" ? bucket.inputTokens : 0,
          cachedInputTokens: key === "cacheRead" ? bucket.cachedInputTokens : 0,
          cacheCreationInputTokens:
            key === "cacheWrite" ? bucket.cacheCreationInputTokens : 0,
          outputTokens: key === "output" ? bucket.outputTokens : 0,
          reasoningOutputTokens:
            key === "reasoning" ? bucket.reasoningOutputTokens : 0,
          totalTokens: bucket.totalTokens,
        };
        cost = mergeCosts(
          cost,
          scaleCostCounts(estimateEventCost(synthetic), bucket.count),
        );
      }
      return { key, ...row.totals, cost };
    })
    .sort(
      (left, right) =>
        right.totalTokens - left.totalTokens ||
        left.key.localeCompare(right.key),
    );
}

export function aggregatePricedUsage(
  events: LocalUsageEvent[],
  dimension: UsageDimension,
): PricedUsageRow[] {
  if (dimension === "tokenType") {
    return aggregateTokenTypeRows(events);
  }
  const rows = new Map<
    string,
    { events: LocalUsageEvent[]; totals: LocalUsageTotals }
  >();

  for (const event of events) {
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
  if (period === "90d") from = localDateKey(addDays(now, -89));
  if (period === "180d") from = localDateKey(addDays(now, -179));
  if (period === "1y") from = localDateKey(addDays(now, -364));
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
 * Format a cost estimate as a bare amount (exact + estimated subtotal), or
 * null when nothing is priced and something is unknown. The "price unknown" /
 * "(partially unknown)" / "estimated" wording lives in the message catalogs
 * (pricing.*) and is composed with `t()` at the display boundary — never
 * concatenated in lib code.
 */
export function formatCostAmount(
  locale: Locale,
  cost: CostEstimate,
  currency: Currency,
  rate?: number,
): string | null {
  if (
    cost.pricedEvents === 0 &&
    cost.estimatedEvents === 0 &&
    cost.unknownEvents > 0
  ) {
    return null;
  }
  return formatMoney(locale, cost.knownUsd + cost.estimatedUsd, currency, rate);
}

/**
 * Display name for a usage source (F6-T3): projected from the tool registry's
 * canonical `name` via `getToolDisplay`. Unknown ids (not in the registry)
 * fall back to the raw id. This module already depends on the registry
 * (usage-plan / model-observation lookups), so no new bundle surface is added.
 */
export function sourceName(source: LocalUsageSource | string) {
  return getToolDisplay(source)?.name ?? source;
}

function perMillion(tokens: number, rate: number) {
  return (tokens / 1_000_000) * rate;
}

function emptyCost(): CostEstimate {
  return {
    knownUsd: 0,
    estimatedUsd: 0,
    cacheSavingsUsd: 0,
    pricedEvents: 0,
    estimatedEvents: 0,
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
    estimatedUsd: left.estimatedUsd + right.estimatedUsd,
    cacheSavingsUsd: left.cacheSavingsUsd + right.cacheSavingsUsd,
    pricedEvents: left.pricedEvents + right.pricedEvents,
    estimatedEvents: left.estimatedEvents + right.estimatedEvents,
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
