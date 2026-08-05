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
 * rate/date/source (docs/plan v1.2 同一汇率快照).
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
