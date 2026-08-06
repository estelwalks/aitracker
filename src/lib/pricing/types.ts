import type { Currency } from "../i18n/locale";

/**
 * Exchange-rate snapshot for display-currency conversion. Model prices come
 * from the offline rule-pack registry (resolve.ts), NOT this snapshot; the
 * snapshot only carries exchange rates + the rule-pack version stamp so the UI
 * can show "price version / rate date / rate source" (docs §6.5: split rule
 * version from exchange snapshot).
 */
export interface PricingSnapshot {
  generatedAt: string;
  /** Offline rule-pack version (sha256 prefix) backing model prices. */
  pricingRulesVersion: string;
  usdToCny: number;
  exchangeRateDate: string;
  exchangeRateSource: "live" | "cache" | "stale-cache" | "fallback";
  /** All display-currency rates from one snapshot (USD is always 1). */
  exchangeRates: Record<string, number>;
}
