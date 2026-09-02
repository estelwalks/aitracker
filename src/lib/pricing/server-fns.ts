import { createServerFn } from "@tanstack/react-start";

import { AppError } from "../errors";

import type { Currency } from "../i18n/locale";
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

/**
 * P3-T3-11: manual exchange-rate refresh goes through the unified task
 * runtime (`exchange.refresh`): the network attempt is single-flighted
 * against scheduled runs, subject to the policy timeout, and recorded in the
 * run store. The handler waits for the run to finish (bounded) and then
 * returns the freshly cached snapshot so the settings-page UX is unchanged —
 * only the execution path changed.
 */
export const refreshExchangeRates = createServerFn({ method: "POST" }).handler(
  async (): Promise<RatesSnapshot> => {
    try {
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
      // The task wrote the fresh cache when the network was available. When
      // it did not, this cache-only read returns stale-cache/builtin rates;
      // both are valid offline UI states and must not become an RPC error.
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
      return value;
    } catch {
      // A broken scheduler/database path must not turn an offline manual
      // refresh into an application error. Return the last in-memory value or
      // the built-in snapshot if no value has been loaded yet.
      if (ratesCache) return ratesCache.value;
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
      return value;
    }
  },
);
