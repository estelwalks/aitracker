import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { BUILTIN_RATES } from "./index.ts";
import type { Currency } from "../i18n/locale";
import type { PricingSnapshot, RuntimeModelPrice } from "./types.ts";

const PRICE_URLS = [
  "https://cdn.jsdelivr.net/gh/BerriAI/litellm@main/model_prices_and_context_window.json",
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json",
];
// One request fetches all three non-USD display currencies (docs/plan v1.2).
const EXCHANGE_URL =
  "https://api.frankfurter.dev/v2/latest?base=USD&symbols=CNY,JPY,KRW";
const PRICE_TTL_MS = 24 * 60 * 60 * 1_000;
const EXCHANGE_TTL_MS = 60 * 60 * 1_000;
const FETCH_TIMEOUT_MS = 15_000;
const FALLBACK_USD_TO_CNY = BUILTIN_RATES.CNY;
/** Exchange-rate cache file (per-currency rates, single date/source stamp). */
const EXCHANGE_CACHE_FILE = "usd-rates.json";

interface LiteLlmPrice {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_read_input_token_cost?: number;
  cache_creation_input_token_cost?: number;
}

interface PriceCache {
  fetchedAt: string;
  source: string;
  prices: Record<string, LiteLlmPrice>;
}

interface ExchangeCache {
  fetchedAt: string;
  date: string;
  rates: Partial<Record<Currency, number>>;
}

interface PricingOptions {
  homeDirectory?: string;
  now?: Date;
  fetcher?: typeof fetch;
  /** Force a network refresh attempt even when the cache is fresh. */
  refreshExchange?: boolean;
}

const OFFICIAL_PRICES: Record<string, Omit<RuntimeModelPrice, "model">> = {
  "deepseek-v4-pro": {
    inputUsdPerMillion: 0.435,
    outputUsdPerMillion: 0.87,
    cacheReadUsdPerMillion: 0.003625,
    cacheWriteUsdPerMillion: 0,
    source: "DeepSeek 官方定价",
  },
  "minimax-m2-5": {
    inputUsdPerMillion: 0.3,
    outputUsdPerMillion: 1.2,
    cacheReadUsdPerMillion: 0.03,
    cacheWriteUsdPerMillion: 0.375,
    source: "MiniMax 官方定价",
  },
  "minimax-m2-7-highspeed": {
    inputUsdPerMillion: 0.6,
    outputUsdPerMillion: 2.4,
    cacheReadUsdPerMillion: 0.06,
    cacheWriteUsdPerMillion: 0.375,
    source: "MiniMax 官方定价",
  },
  "glm-5": {
    inputUsdPerMillion: 1,
    outputUsdPerMillion: 3.2,
    cacheReadUsdPerMillion: 0.2,
    cacheWriteUsdPerMillion: null,
    source: "LiteLLM · GLM-5",
  },
};

function normalizedModel(value: string): string {
  return value.trim().toLowerCase().replaceAll("_", "-").replaceAll(".", "-");
}

function positiveOrZero(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Return the numeric rate or 0 when invalid (callers treat 0 as missing). */
function parseRate(value: unknown): number {
  return positiveOrZero(value) ? value : 0;
}

function usablePrice(value: LiteLlmPrice | undefined): value is LiteLlmPrice & {
  input_cost_per_token: number;
  output_cost_per_token: number;
} {
  return (
    value != null &&
    positiveOrZero(value.input_cost_per_token) &&
    positiveOrZero(value.output_cost_per_token)
  );
}

function runtimePrice(
  model: string,
  value: LiteLlmPrice,
  source: string,
): RuntimeModelPrice {
  return {
    model,
    inputUsdPerMillion: (value.input_cost_per_token ?? 0) * 1_000_000,
    outputUsdPerMillion: (value.output_cost_per_token ?? 0) * 1_000_000,
    cacheReadUsdPerMillion:
      (value.cache_read_input_token_cost ?? value.input_cost_per_token ?? 0) *
      1_000_000,
    cacheWriteUsdPerMillion: positiveOrZero(
      value.cache_creation_input_token_cost,
    )
      ? value.cache_creation_input_token_cost * 1_000_000
      : null,
    source,
  };
}

function resolveLiteLlmPrice(
  model: string,
  catalog: Record<string, LiteLlmPrice>,
): RuntimeModelPrice | undefined {
  const normalized = normalizedModel(model);
  const entries = Object.entries(catalog).filter(([, value]) =>
    usablePrice(value),
  );
  const exact = entries.find(([key]) => normalizedModel(key) === normalized);
  if (exact) return runtimePrice(model, exact[1], `LiteLLM · ${exact[0]}`);

  const suffixMatches = entries.filter(([key]) =>
    normalizedModel(key).endsWith(`/${normalized}`),
  );
  if (suffixMatches.length === 1) {
    return runtimePrice(
      model,
      suffixMatches[0]![1],
      `LiteLLM · ${suffixMatches[0]![0]}`,
    );
  }
  if (suffixMatches.length > 1) {
    const signatures = new Set(
      suffixMatches.map(([, value]) =>
        [
          value.input_cost_per_token,
          value.output_cost_per_token,
          value.cache_read_input_token_cost,
          value.cache_creation_input_token_cost,
        ].join(":"),
      ),
    );
    if (signatures.size === 1) {
      return runtimePrice(
        model,
        suffixMatches[0]![1],
        `LiteLLM · 多 Provider 同价`,
      );
    }
  }

  const snapshotMatches = entries.filter(([key]) => {
    const candidate = normalizedModel(key).split("/").at(-1) ?? "";
    return (
      candidate.startsWith(`${normalized}-20`) ||
      candidate.startsWith(`${normalized}-`)
    );
  });
  if (snapshotMatches.length === 1) {
    return runtimePrice(
      model,
      snapshotMatches[0]![1],
      `LiteLLM · ${snapshotMatches[0]![0]}`,
    );
  }
  return undefined;
}

async function isFresh(
  path: string,
  ttlMs: number,
  now: Date,
): Promise<boolean> {
  try {
    return now.getTime() - (await stat(path)).mtimeMs < ttlMs;
  } catch {
    return false;
  }
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

async function loadPriceCatalog(
  cachePath: string,
  now: Date,
  fetcher: typeof fetch,
): Promise<{ cache?: PriceCache; source: PricingSnapshot["priceSource"] }> {
  const cached = await readJson<PriceCache>(cachePath);
  if (cached && (await isFresh(cachePath, PRICE_TTL_MS, now))) {
    return { cache: cached, source: "cache" };
  }
  for (const url of PRICE_URLS) {
    try {
      const prices = (await fetchJson(url, fetcher)) as Record<
        string,
        LiteLlmPrice
      >;
      const next = { fetchedAt: now.toISOString(), source: url, prices };
      await writeJson(cachePath, next);
      return { cache: next, source: "live" };
    } catch {
      continue;
    }
  }
  return cached
    ? { cache: cached, source: "stale-cache" }
    : { source: "fallback" };
}

/**
 * Load the USD→CNY/JPY/KRW exchange rates with per-currency cache + fallback
 * (docs/plan v1.2 汇率与离线):
 *   live        — network refresh succeeded (or force refresh)
 *   cache       — cached value within TTL
 *   stale-cache — cached value older than TTL (still usable)
 *   fallback    — built-in baseline rates
 * All currencies share one fetch and one date/source stamp.
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
  const fresh = cached && (await isFresh(cachePath, EXCHANGE_TTL_MS, now));
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
      throw new Error("汇率响应不完整");
    }
    const rates = {
      CNY: parseRate(value.rates.CNY),
      JPY: parseRate(value.rates.JPY),
      KRW: parseRate(value.rates.KRW),
    };
    if (rates.CNY === 0 || rates.JPY === 0 || rates.KRW === 0) {
      throw new Error("汇率响应缺少币种");
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export async function buildPricingSnapshot(
  models: string[],
  options: PricingOptions = {},
): Promise<PricingSnapshot> {
  const now = options.now ?? new Date();
  const fetcher = options.fetcher ?? fetch;
  const cacheDirectory = join(
    options.homeDirectory ?? homedir(),
    ".trusttools",
    "cache",
  );
  // 空模型列表(汇率刷新场景)只取汇率,不触碰价格目录。
  const [catalog, exchange] =
    models.length === 0
      ? [
          null,
          await loadExchangeRates(
            join(cacheDirectory, EXCHANGE_CACHE_FILE),
            now,
            fetcher,
            options.refreshExchange,
          ),
        ]
      : await Promise.all([
          loadPriceCatalog(
            join(cacheDirectory, "model-prices.json"),
            now,
            fetcher,
          ),
          loadExchangeRates(
            join(cacheDirectory, EXCHANGE_CACHE_FILE),
            now,
            fetcher,
            options.refreshExchange,
          ),
        ]);
  const exchangeRateCny = exchange.rates.CNY ?? BUILTIN_RATES.CNY;
  const prices: Record<string, RuntimeModelPrice> = {};
  for (const model of [...new Set(models)].slice(0, 1_000)) {
    const normalized = normalizedModel(model);
    const official = OFFICIAL_PRICES[normalized];
    let resolved =
      official == null
        ? resolveLiteLlmPrice(model, catalog?.cache?.prices ?? {})
        : { model, ...official };
    if (normalized === "doubao-seed-2-0-code") {
      const usd = (cny: number) => cny / exchangeRateCny;
      resolved = {
        model,
        inputUsdPerMillion: usd(3.2),
        outputUsdPerMillion: usd(16),
        cacheReadUsdPerMillion: usd(0.64),
        cacheWriteUsdPerMillion: null,
        source: "火山引擎官方阶梯定价",
        tiers: [
          {
            maxInputTokens: 32_000,
            inputUsdPerMillion: usd(3.2),
            outputUsdPerMillion: usd(16),
            cacheReadUsdPerMillion: usd(0.64),
          },
          {
            maxInputTokens: 128_000,
            inputUsdPerMillion: usd(4.8),
            outputUsdPerMillion: usd(24),
            cacheReadUsdPerMillion: usd(0.96),
          },
          {
            maxInputTokens: null,
            inputUsdPerMillion: usd(9.6),
            outputUsdPerMillion: usd(48),
            cacheReadUsdPerMillion: usd(1.92),
          },
        ],
      };
    }
    if (resolved) prices[normalized] = resolved;
  }
  return {
    generatedAt: now.toISOString(),
    prices,
    priceSource: catalog?.source ?? "fallback",
    priceSourceLabel: catalog?.cache?.source ?? "内置价格回退",
    modelCount: Object.keys(catalog?.cache?.prices ?? {}).length,
    usdToCny: exchangeRateCny,
    exchangeRateDate: exchange.date,
    exchangeRateSource: exchange.source,
    exchangeRates: exchange.rates,
  };
}
