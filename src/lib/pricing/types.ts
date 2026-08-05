export interface RuntimeModelPrice {
  model: string;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cacheReadUsdPerMillion: number;
  cacheWriteUsdPerMillion: number | null;
  source: string;
  tiers?: RuntimePriceTier[];
}

export interface RuntimePriceTier {
  maxInputTokens: number | null;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cacheReadUsdPerMillion: number;
}

export interface PricingSnapshot {
  generatedAt: string;
  prices: Record<string, RuntimeModelPrice>;
  priceSource: "live" | "cache" | "stale-cache" | "fallback";
  priceSourceLabel: string;
  modelCount: number;
  usdToCny: number;
  exchangeRateDate: string;
  exchangeRateSource: "live" | "cache" | "stale-cache" | "fallback";
  /** All display-currency rates from one snapshot (USD is always 1). */
  exchangeRates: Record<string, number>;
}
