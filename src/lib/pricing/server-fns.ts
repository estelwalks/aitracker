import { createServerFn } from "@tanstack/react-start";

import { AppError } from "../errors";

import type { Currency } from "../i18n/locale";
import type { ExchangeRateSnapshot } from "../../platform/snapshot-runtime/exchange-rate.server.ts";
import type { PricingSnapshot } from "./types.ts";

export const getPricingSnapshot = createServerFn({ method: "POST" })
  .validator((models: string[]) => {
    if (!Array.isArray(models) || models.length > 1_000)
      throw new AppError("errors.pricing.modelListInvalid");
    return models.filter(
      (model) => typeof model === "string" && model.trim().length > 0,
    );
  })
  .handler(async ({ data }): Promise<PricingSnapshot> => {
    const { buildPricingSnapshot } = await import("./dynamic.server.ts");
    return buildPricingSnapshot(data);
  });

export interface RatesSnapshot {
  rates: Record<Currency, number>;
  date: string;
  source: PricingSnapshot["exchangeRateSource"];
  /**
   * Manual-refresh outcome marker, set only by `refreshExchangeRates`. True
   * when the `exchange.refresh` run actually rewrote the persistent http-cache
   * (its fetchedAt advanced). Read-path snapshots (`getRatesSnapshot`, route
   * loaders, the in-memory TTL) never carry this field — they keep the plain
   * cache/stale-cache/fallback labels, so callers must never infer a manual
   * refresh outcome from `source` alone.
   */
  refreshed?: boolean;
}

/**
 * Exchange-rate snapshot for the display-currency UI. `refresh` forces a
 * network attempt; otherwise the cached/built-in rates are returned. The
 * renderer uses one snapshot everywhere so every amount shares the same
 * rate/date/source (docs/plan v1.2 same rate snapshot).
 */
// 30s in-memory TTL so route loaders don't re-read the rates file on every
// navigation; `refresh: true` always bypasses it.
const RATES_TTL_MS = 30_000;
let ratesCache: { at: number; value: RatesSnapshot } | null = null;

export const getRatesSnapshot = createServerFn({ method: "POST" })
  .validator((refresh: boolean) => typeof refresh === "boolean")
  .handler(async ({ data: refresh }): Promise<RatesSnapshot> => {
    if (!refresh && ratesCache && Date.now() - ratesCache.at < RATES_TTL_MS) {
      return ratesCache.value;
    }
    const { buildPricingSnapshot } = await import("./dynamic.server.ts");
    const snapshot = await buildPricingSnapshot([], {
      refreshExchange: refresh,
    });
    const value: RatesSnapshot = {
      rates: snapshot.exchangeRates as Record<Currency, number>,
      date: snapshot.exchangeRateDate,
      source: snapshot.exchangeRateSource,
    };
    ratesCache = { at: Date.now(), value };
    return value;
  });

/** Manual-refresh result: the plain snapshot plus whether the refresh wrote fresh data. */
export type RefreshedRatesSnapshot = RatesSnapshot & {
  readonly refreshed: boolean;
};

export interface ExchangeRateRefreshDeps {
  /**
   * Queue the `exchange.refresh` task through the task runtime and wait
   * (bounded) for it to settle. A failed/offline run resolves normally (the
   * run record carries the failure); only an unrecoverable task-runtime error
   * rejects.
   */
  readonly runRefresh: () => Promise<void>;
  /** Cache-only snapshot read; never performs network I/O. */
  readonly readCache: () => Promise<ExchangeRateSnapshot>;
}

/**
 * P3-T3-11: manual exchange-rate refresh core.
 *
 * The refresh runs through the unified task runtime (`exchange.refresh`), but
 * its success must not be read back from the post-run snapshot's `source`
 * field: the task writes the http-cache and the cache-only read that follows
 * only ever returns `cache`/`stale-cache`/`fallback` (never `live`, which is
 * produced solely inside `repository.refresh()`). Success is therefore judged
 * by whether the persistent cache was actually rewritten — `fetchedAt`
 * advanced between the read before the run and the read after it. That stays
 * true for an online fetch, false for an offline run that kept last-known-good
 * (fresh cache included), and is robust to single-flight deduping when a
 * scheduled run already owns the refresh.
 */
export async function performExchangeRateRefresh(
  options: ExchangeRateRefreshDeps,
): Promise<RefreshedRatesSnapshot> {
  const before = await options.readCache();
  await options.runRefresh();
  const after = await options.readCache();
  const refreshed =
    after.fetchedAt !== null &&
    (before.fetchedAt === null ||
      Date.parse(after.fetchedAt) > Date.parse(before.fetchedAt));
  return {
    rates: { ...after.rates },
    date: after.date,
    source: after.source,
    refreshed,
  };
}

/** Plain (marker-free) copy for the shared in-memory TTL cache. */
function plainRates(value: RatesSnapshot): RatesSnapshot {
  return { rates: value.rates, date: value.date, source: value.source };
}

async function readPersistedCache(): Promise<ExchangeRateSnapshot> {
  const { createExchangeRateRepository } =
    await import("../../platform/snapshot-runtime/exchange-rate.server.ts");
  return createExchangeRateRepository().readCache();
}

async function runQueuedExchangeRefresh(): Promise<void> {
  const { getCompositionRoot } =
    await import("../../app/composition.server.ts");
  const { taskApi } = await getCompositionRoot();
  const queued = await taskApi.runNow({ taskId: "exchange.refresh" });
  if (queued.ok) {
    await taskApi.awaitRun({
      runId: queued.value.runId,
      timeoutMs: 25_000,
    });
  }
}

/**
 * P3-T3-11: manual exchange-rate refresh goes through the unified task
 * runtime (`exchange.refresh`): the network attempt is single-flighted
 * against scheduled runs, subject to the policy timeout, and recorded in the
 * run store. The handler waits for the run to finish (bounded), then returns
 * the freshly cached snapshot so the settings-page UX is unchanged — only the
 * execution path changed. `refreshed` reports whether the run actually wrote
 * fresh data (see `performExchangeRateRefresh`); it never rejects on an
 * offline outcome.
 */
export const refreshExchangeRates = createServerFn({ method: "POST" }).handler(
  async (): Promise<RefreshedRatesSnapshot> => {
    try {
      const result = await performExchangeRateRefresh({
        runRefresh: runQueuedExchangeRefresh,
        readCache: readPersistedCache,
      });
      // The shared TTL cache serves plain read-path snapshots only; strip the
      // transient refresh marker so later `getRatesSnapshot` calls never leak it.
      ratesCache = { at: Date.now(), value: plainRates(result) };
      return result;
    } catch {
      // A broken scheduler/database path must not turn an offline manual
      // refresh into an application error. Return the last in-memory value or
      // the built-in snapshot if no value has been loaded yet.
      if (ratesCache) return { ...ratesCache.value, refreshed: false };
      const { buildPricingSnapshot } = await import("./dynamic.server.ts");
      const snapshot = await buildPricingSnapshot([], {
        refreshExchange: false,
      });
      const value: RatesSnapshot = {
        rates: snapshot.exchangeRates as Record<Currency, number>,
        date: snapshot.exchangeRateDate,
        source: snapshot.exchangeRateSource,
      };
      ratesCache = { at: Date.now(), value };
      return { ...value, refreshed: false };
    }
  },
);
