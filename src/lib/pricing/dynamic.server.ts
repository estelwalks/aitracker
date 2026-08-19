import { homedir } from "node:os";

import { BUILTIN_RATES } from "./index.ts";
import { PRICING_RULES_VERSION } from "./registry.ts";
import type { PricingSnapshot } from "./types.ts";
import type {
  ExchangeRateCache,
  ExchangeRateRepository,
} from "../../platform/snapshot-runtime/exchange-rate.server.ts";

// Model prices are offline rule packs (resolve.ts); this module only loads
// display-currency exchange rates. One request fetches all three non-USD
// display currencies (docs/plan v1.2 汇率与离线). Freshness, timeout and
// network permission come exclusively from the public runtime policy source
// (`src/app/runtime-policy.source.json` -> exchangeRates).
//
// P3-T3-05: page reads are cache-only. A stale cache is still returned and the
// network refresh happens only through the task runtime (or an explicit
// `refreshExchange` call) — a page loader never blocks on the network.
//
// P6-T6-01: the exchange-rate repository is loaded dynamically so this module
// never statically reaches node:fs/os from the browser graph.

export interface PricingOptions {
  homeDirectory?: string;
  now?: Date;
  fetcher?: typeof fetch;
  /** Injectable cache for isolated callers/tests; production uses SQLite. */
  cache?: ExchangeRateCache;
  /** Force a network refresh attempt even when the cache is fresh. */
  refreshExchange?: boolean;
}

let repositoryPromise: Promise<ExchangeRateRepository> | undefined;

async function getExchangeRepository(
  options: PricingOptions,
): Promise<ExchangeRateRepository> {
  if (options.fetcher || options.now || options.cache) {
    // Test seams: build a fresh repository with the injected fetcher/clock.
    const { createExchangeRateRepository } =
      await import("../../platform/snapshot-runtime/exchange-rate.server.ts");
    return createExchangeRateRepository({
      fetcher: options.fetcher,
      now: options.now ? () => options.now! : undefined,
      cache: options.cache,
    });
  }
  if (!repositoryPromise) {
    repositoryPromise =
      import("../../platform/snapshot-runtime/exchange-rate.server.ts").then(
        ({ createExchangeRateRepository }) => createExchangeRateRepository(),
      );
  }
  return repositoryPromise;
}

/**
 * Build a pricing snapshot. Model prices are resolved offline from the rule-pack
 * registry at event time (resolve.ts); this snapshot only carries exchange
 * rates and the rule-pack version stamp. The `models` argument is retained for
 * signature compatibility but no longer drives any network fetch.
 *
 * Default behavior is cache-only (fresh cache, stale cache, or builtin
 * fallback). `refreshExchange: true` performs a network refresh and keeps
 * last-known-good on failure.
 */
export async function buildPricingSnapshot(
  _models: string[],
  options: PricingOptions = {},
): Promise<PricingSnapshot> {
  const now = options.now ?? new Date();
  const homeDirectory = options.homeDirectory ?? homedir();
  const exchangeRepository = await getExchangeRepository(options);
  const exchange = options.refreshExchange
    ? await exchangeRepository.refresh({
        homeDirectory,
        fetcher: options.fetcher,
        now,
      })
    : await exchangeRepository.readCache({ homeDirectory });
  return {
    generatedAt: now.toISOString(),
    pricingRulesVersion: PRICING_RULES_VERSION,
    usdToCny: exchange.rates.CNY ?? BUILTIN_RATES.CNY,
    exchangeRateDate: exchange.date,
    exchangeRateSource: exchange.source,
    exchangeRates: exchange.rates,
  };
}
