import { BUILTIN_RATES } from "../../lib/pricing/index.ts";
import { RUNTIME_POLICY } from "../../app/runtime-policy.generated.ts";
import type { Currency } from "../../lib/i18n/locale.ts";
import { MARKET_API_BASE } from "../../lib/app-config.ts";
import { fetchExternal } from "../../lib/http/external-request.server.ts";

/**
 * P3-T3-05: Exchange-rate snapshot.
 *
 * Pages only read fresh/stale/builtin rates — never network. Automatic
 * refreshes are driven by the task runtime against the runtime policy
 * (`exchangeRates.freshForMinutes = 1440`): within 24h no network attempt is
 * made; after expiry the stale cache is still returned while a background
 * refresh runs. Offline failures keep last-known-good.
 */

export interface ExchangeCache {
  fetchedAt: string;
  date: string;
  rates: Partial<Record<Currency, number>>;
}

export interface ExchangeRateCache {
  read(): Promise<ExchangeCache | undefined>;
  write(value: ExchangeCache): Promise<void>;
}

export type ExchangeRateSource = "live" | "cache" | "stale-cache" | "fallback";

export interface ExchangeRateSnapshot {
  readonly rates: Record<Currency, number>;
  readonly date: string;
  readonly source: ExchangeRateSource;
  readonly fetchedAt: string | null;
  readonly stale: boolean;
}

export interface ExchangeRateRepository {
  /** Cache-only read; never performs network I/O (page-safe). */
  readCache(options?: {
    readonly homeDirectory?: string;
  }): Promise<ExchangeRateSnapshot>;
  /** Network refresh through the task runtime; keeps last-known-good on failure. */
  refresh(options?: {
    readonly homeDirectory?: string;
    readonly fetcher?: typeof fetch;
    readonly now?: Date;
  }): Promise<ExchangeRateSnapshot>;
}

function positiveOrZero(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

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

export const EXCHANGE_RATE_URL = `${MARKET_API_BASE}/v2/rates?base=USD&quotes=CNY,JPY,KRW`;

const EXCHANGE_QUOTES = ["CNY", "JPY", "KRW"] as const;

function validDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
  );
}

function parseRemoteRates(
  value: unknown,
):
  | { readonly date: string; readonly rates: Record<Currency, number> }
  | undefined {
  if (!Array.isArray(value) || value.length !== EXCHANGE_QUOTES.length)
    return undefined;

  let date: string | undefined;
  const rates: Partial<Record<Currency, number>> = {};
  for (const row of value) {
    if (!isRecord(row)) return undefined;
    if (row.base !== "USD" || !validDate(row.date)) return undefined;
    if (date !== undefined && date !== row.date) return undefined;
    date = row.date;
    if (
      typeof row.quote !== "string" ||
      !EXCHANGE_QUOTES.includes(row.quote as (typeof EXCHANGE_QUOTES)[number])
    )
      return undefined;
    const quote = row.quote as Currency;
    if (rates[quote] !== undefined) return undefined;
    if (!positiveOrZero(row.rate) || row.rate <= 0) return undefined;
    rates[quote] = row.rate;
  }

  if (date === undefined) return undefined;
  if (EXCHANGE_QUOTES.some((quote) => rates[quote] === undefined))
    return undefined;
  return {
    date,
    rates: {
      CNY: rates.CNY!,
      JPY: rates.JPY!,
      KRW: rates.KRW!,
      USD: 1,
    },
  };
}

function normalizeCached(
  cached: ExchangeCache | undefined,
  now: Date,
): ExchangeCache | undefined {
  if (!isRecord(cached)) return undefined;
  const rates: Partial<Record<Currency, number>> = {};
  for (const quote of EXCHANGE_QUOTES) {
    if (positiveOrZero(cached.rates?.[quote]) && cached.rates[quote] > 0)
      rates[quote] = cached.rates[quote];
  }
  if (Object.keys(rates).length === 0) return undefined;
  return {
    fetchedAt:
      typeof cached.fetchedAt === "string" &&
      Number.isFinite(Date.parse(cached.fetchedAt))
        ? cached.fetchedAt
        : new Date(0).toISOString(),
    date: validDate(cached.date) ? cached.date : now.toISOString().slice(0, 10),
    rates,
  };
}

async function fetchRemoteRates(
  runFetcher: typeof fetch,
  timeoutMs: number,
): Promise<ReturnType<typeof parseRemoteRates>> {
  const controller = new AbortController();
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  const request = fetchExternal(
    EXCHANGE_RATE_URL,
    {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    },
    runFetcher,
  ).then(async (response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return parseRemoteRates(await response.json());
  });
  const timeout = new Promise<never>((_, reject) => {
    timeoutTimer = setTimeout(() => {
      controller.abort();
      reject(new Error("exchange rate request timed out"));
    }, timeoutMs);
  });
  try {
    const parsed = await Promise.race([request, timeout]);
    if (!parsed) throw new Error("incomplete rate response");
    return parsed;
  } finally {
    if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
  }
}

async function defaultCache(): Promise<ExchangeRateCache> {
  const { getCompositionRoot } =
    await import("../../app/composition.server.ts");
  const repository = (await getCompositionRoot()).database.features.httpCache;
  return {
    async read() {
      return (await repository.get<ExchangeCache>("exchange-rates", "usd"))
        ?.payload;
    },
    async write(value) {
      const fetchedAtMs = Date.parse(value.fetchedAt);
      await repository.put({
        namespace: "exchange-rates",
        key: "usd",
        payload: value,
        fetchedAtMs,
        expiresAtMs: Number.MAX_SAFE_INTEGER,
      });
    },
  };
}

function builtinFallback(now: Date): ExchangeRateSnapshot {
  return {
    rates: { ...BUILTIN_RATES } as Record<Currency, number>,
    date: now.toISOString().slice(0, 10),
    source: "fallback",
    fetchedAt: null,
    stale: false,
  };
}

export function createExchangeRateRepository(
  options: {
    readonly fetcher?: typeof fetch;
    readonly now?: () => Date;
    readonly cache?: ExchangeRateCache;
    readonly timeoutMs?: number;
  } = {},
): ExchangeRateRepository {
  const policy = RUNTIME_POLICY.snapshotPolicies.exchangeRates;
  const freshForMs = policy.freshForMinutes * 60 * 1000;
  const timeoutMs = options.timeoutMs ?? policy.timeoutMs;

  const cache = async () => options.cache ?? defaultCache();
  const loadCached = async (): Promise<ExchangeCache | undefined> =>
    (await cache()).read();

  const snapshotFromCache = (
    cached: ExchangeCache | undefined,
    now: Date,
  ): ExchangeRateSnapshot => {
    const normalized = normalizeCached(cached, now);
    if (!normalized) return builtinFallback(now);
    const fetchedAt = new Date(normalized.fetchedAt);
    const stale =
      !Number.isFinite(fetchedAt.getTime()) ||
      now.getTime() - fetchedAt.getTime() >= freshForMs;
    return {
      rates: withFallbacks(normalized.rates),
      date: normalized.date,
      source: stale ? "stale-cache" : "cache",
      fetchedAt: normalized.fetchedAt,
      stale,
    };
  };

  return {
    async readCache() {
      let cached: ExchangeCache | undefined;
      try {
        cached = await loadCached();
      } catch {
        cached = undefined;
      }
      return snapshotFromCache(cached, options.now?.() ?? new Date());
    },

    async refresh({ fetcher, now } = {}) {
      const current = now ?? options.now?.() ?? new Date();
      const runFetcher = fetcher ?? options.fetcher ?? fetch;
      let cached: ExchangeCache | undefined;
      try {
        cached = await loadCached();
      } catch {
        cached = undefined;
      }
      let next: ExchangeCache;
      try {
        const parsed = await fetchRemoteRates(runFetcher, timeoutMs);
        if (!parsed) throw new Error("incomplete rate response");
        next = {
          fetchedAt: current.toISOString(),
          date: parsed.date,
          rates: parsed.rates,
        };
      } catch {
        // Offline/failure: keep last-known-good (stale cache or builtin).
        return snapshotFromCache(cached, current);
      }
      // SQLite persistence failures are fatal; only network/response failures
      // may use the last known business value.
      await (await cache()).write(next);
      return {
        rates: { ...next.rates, USD: 1 } as Record<Currency, number>,
        date: next.date,
        source: "live",
        fetchedAt: next.fetchedAt,
        stale: false,
      };
    },
  };
}
