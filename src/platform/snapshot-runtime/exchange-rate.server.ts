import { BUILTIN_RATES } from "../../lib/pricing/index.ts";
import { RUNTIME_POLICY } from "../../app/runtime-policy.generated.ts";
import type { Currency } from "../../lib/i18n/locale.ts";

/**
 * P3-T3-05: Exchange-rate snapshot.
 *
 * Pages only read fresh/stale/builtin rates — never network. Automatic
 * refreshes are driven by the task runtime against the runtime policy
 * (`exchangeRates.freshForMinutes = 1440`): within 24h no network attempt is
 * made; after expiry the stale cache is still returned while a background
 * refresh runs. Offline failures keep last-known-good.
 */

interface ExchangeCache {
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

function parseRate(value: unknown): number {
  return positiveOrZero(value) ? value : 0;
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

const EXCHANGE_URL =
  "https://api.frankfurter.dev/v2/latest?base=USD&symbols=CNY,JPY,KRW";

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
  } = {},
): ExchangeRateRepository {
  const policy = RUNTIME_POLICY.snapshotPolicies.exchangeRates;
  const freshForMs = policy.freshForMinutes * 60 * 1000;

  const cache = async () => options.cache ?? defaultCache();
  const loadCached = async (): Promise<ExchangeCache | undefined> =>
    (await cache()).read();

  const snapshotFromCache = (
    cached: ExchangeCache | undefined,
    now: Date,
  ): ExchangeRateSnapshot => {
    if (!cached) return builtinFallback(now);
    const fetchedAt = new Date(cached.fetchedAt);
    const stale =
      !Number.isFinite(fetchedAt.getTime()) ||
      now.getTime() - fetchedAt.getTime() >= freshForMs;
    return {
      rates: withFallbacks(cached.rates),
      date: cached.date,
      source: stale ? "stale-cache" : "cache",
      fetchedAt: cached.fetchedAt,
      stale,
    };
  };

  return {
    async readCache() {
      return snapshotFromCache(
        await loadCached(),
        options.now?.() ?? new Date(),
      );
    },

    async refresh({ fetcher, now } = {}) {
      const current = now ?? options.now?.() ?? new Date();
      const runFetcher = fetcher ?? options.fetcher ?? fetch;
      const cached = await loadCached();
      let next: ExchangeCache;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), policy.timeoutMs);
        let response: Response;
        try {
          response = await runFetcher(EXCHANGE_URL, {
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const value = (await response.json()) as {
          date?: unknown;
          rates?: Record<string, unknown>;
        };
        if (typeof value.date !== "string" || !isRecord(value.rates))
          throw new Error("incomplete rate response");
        const rates = {
          CNY: parseRate(value.rates.CNY),
          JPY: parseRate(value.rates.JPY),
          KRW: parseRate(value.rates.KRW),
        };
        if (rates.CNY === 0 || rates.JPY === 0 || rates.KRW === 0)
          throw new Error("missing currency");
        next = {
          fetchedAt: current.toISOString(),
          date: value.date,
          rates,
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
