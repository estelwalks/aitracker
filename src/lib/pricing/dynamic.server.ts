import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { BUILTIN_RATES } from "./index.ts";
import { PRICING_RULES_VERSION } from "./registry.ts";
import type { Currency } from "../i18n/locale";
import type { PricingSnapshot } from "./types.ts";
import { APP_DATA_DIR } from "../app-config";
import { AppError } from "../errors";

// Model prices are offline rule packs (resolve.ts); this module only loads
// display-currency exchange rates. One request fetches all three non-USD
// display currencies (docs/plan v1.2 汇率与离线).
const EXCHANGE_URL =
  "https://api.frankfurter.dev/v2/latest?base=USD&symbols=CNY,JPY,KRW";
const EXCHANGE_TTL_MS = 60 * 60 * 1_000;
const FETCH_TIMEOUT_MS = 15_000;
/** Exchange-rate cache file (per-currency rates, single date/source stamp). */
const EXCHANGE_CACHE_FILE = "usd-rates.json";

interface ExchangeCache {
  fetchedAt: string;
  date: string;
  rates: Partial<Record<Currency, number>>;
}

export interface PricingOptions {
  homeDirectory?: string;
  now?: Date;
  fetcher?: typeof fetch;
  /** Force a network refresh attempt even when the cache is fresh. */
  refreshExchange?: boolean;
}

function positiveOrZero(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Return the numeric rate or 0 when invalid (callers treat 0 as missing). */
function parseRate(value: unknown): number {
  return positiveOrZero(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/** Fill missing per-currency rates with the built-in baseline. */
function withFallbacks(
  rates: Partial<Record<Currency, number>>,
): Record<Currency, number> {
  return {
    CNY: rates.CNY ?? BUILTIN_RATES.CNY,
    JPY: rates.JPY ?? BUILTIN_RATES.JPY,
    KRW: rates.KRW ?? BUILTIN_RATES.KRW,
    USD: 1,
  };
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(value)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

async function fetchJson(url: string, fetcher: typeof fetch): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetcher(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Load the USD->CNY/JPY/KRW exchange rates with per-currency cache + fallback
 * (docs/plan v1.2 汇率与离线):
 *   live        - network refresh succeeded (or force refresh)
 *   cache       - cached value within TTL
 *   stale-cache - cached value older than TTL (still usable)
 *   fallback    - built-in baseline rates
 *
 * Freshness is judged by the cache's stored `fetchedAt` timestamp (not the
 * file mtime) so it is deterministic under injected `now` and immune to real
 * wall-clock drift (docs: cache keyed by the stamp, not the filesystem).
 */
async function loadExchangeRates(
  cachePath: string,
  now: Date,
  fetcher: typeof fetch,
  refresh = false,
): Promise<{
  rates: Record<Currency, number>;
  date: string;
  source: PricingSnapshot["exchangeRateSource"];
}> {
  const cached = await readJson<ExchangeCache>(cachePath);
  const fresh =
    cached && now.getTime() - Date.parse(cached.fetchedAt) < EXCHANGE_TTL_MS;
  if (cached && fresh && !refresh) {
    return {
      rates: withFallbacks(cached.rates),
      date: cached.date,
      source: "cache",
    };
  }
  try {
    const value = (await fetchJson(EXCHANGE_URL, fetcher)) as {
      date?: unknown;
      rates?: Record<string, unknown>;
    };
    if (typeof value.date !== "string" || !isRecord(value.rates)) {
      throw new AppError("errors.pricing.rateResponseIncomplete");
    }
    const rates = {
      CNY: parseRate(value.rates.CNY),
      JPY: parseRate(value.rates.JPY),
      KRW: parseRate(value.rates.KRW),
    };
    if (rates.CNY === 0 || rates.JPY === 0 || rates.KRW === 0) {
      throw new AppError("errors.pricing.rateMissingCurrency");
    }
    const next: ExchangeCache = {
      fetchedAt: now.toISOString(),
      date: value.date,
      rates,
    };
    await writeJson(cachePath, next);
    return { rates: { ...rates, USD: 1 }, date: next.date, source: "live" };
  } catch {
    if (cached) {
      return {
        rates: withFallbacks(cached.rates),
        date: cached.date,
        source: "stale-cache",
      };
    }
    return {
      rates: { ...BUILTIN_RATES } as Record<Currency, number>,
      date: now.toISOString().slice(0, 10),
      source: "fallback",
    };
  }
}

/**
 * Build a pricing snapshot. Model prices are resolved offline from the rule-pack
 * registry at event time (resolve.ts); this snapshot only carries exchange
 * rates and the rule-pack version stamp. The `models` argument is retained for
 * signature compatibility but no longer drives any network fetch.
 */
export async function buildPricingSnapshot(
  _models: string[],
  options: PricingOptions = {},
): Promise<PricingSnapshot> {
  const now = options.now ?? new Date();
  const fetcher = options.fetcher ?? fetch;
  const cacheDirectory = join(
    options.homeDirectory ?? homedir(),
    APP_DATA_DIR,
    "cache",
  );
  const exchange = await loadExchangeRates(
    join(cacheDirectory, EXCHANGE_CACHE_FILE),
    now,
    fetcher,
    options.refreshExchange,
  );
  return {
    generatedAt: now.toISOString(),
    pricingRulesVersion: PRICING_RULES_VERSION,
    usdToCny: exchange.rates.CNY ?? BUILTIN_RATES.CNY,
    exchangeRateDate: exchange.date,
    exchangeRateSource: exchange.source,
    exchangeRates: exchange.rates,
  };
}
