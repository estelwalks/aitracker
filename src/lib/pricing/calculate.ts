/**
 * BigInt nanoUSD cost calculation (docs §5.2, §5.4).
 *
 * Money is always `bigint nanoUsd` (1e-9 USD); the JS `number` type is never
 * used to accumulate money, avoiding float drift. The display layer converts
 * back to decimal/currency at the boundary.
 *
 * Token semantics:
 * - Tier selection uses input-related tokens (input + cacheRead + cacheWrite),
 *   matching the pre-migration Doubao behaviour.
 * - `cacheWrite` rate `null` means "no known price": if the event has cache-write
 *   tokens, the cost is unknowable -> `calculateCost` returns `null` and the
 *   resolver applies the tool's fallback policy.
 * - `reasoningPolicy`: `ignore` (default, pre-migration parity) does not bill
 *   reasoning; `bill-as-output`/`separate` bill reasoning at the output rate.
 * - `cacheSavingsUsdNano` is the notional saving from cache reads (cache-read
 *   tokens billed at the cache-read rate instead of the input rate), floored at 0.
 */
import {
  parseNanoUsd,
  type PricingTokens,
  type RateRule,
  type ToolPricingPolicy,
} from "./contracts.ts";

const MILLION = 1_000_000n;

export interface CostBreakdown {
  input: bigint;
  output: bigint;
  cacheRead: bigint;
  cacheWrite: bigint;
  reasoning: bigint;
}

export interface CostResult {
  knownUsdNano: bigint;
  /** Notional cache-read saving vs billing cached tokens at the input rate. */
  cacheSavingsUsdNano: bigint;
  breakdown: CostBreakdown;
}

/** nanoUSD for `tokens` at `rateNano` nanoUSD-per-million. Integer floor division. */
function perMillion(tokens: bigint, rateNano: bigint): bigint {
  return (tokens * rateNano) / MILLION;
}

interface ResolvedTierRates {
  input: bigint;
  output: bigint;
  cacheRead: bigint;
}

function baseTierRates(rate: RateRule): ResolvedTierRates {
  return {
    input: parseNanoUsd(rate.usdNanoPerMillion.input),
    output: parseNanoUsd(rate.usdNanoPerMillion.output),
    cacheRead: parseNanoUsd(rate.usdNanoPerMillion.cacheRead),
  };
}

/** Select the tier whose maxInputTokens bound covers the input-related tokens. */
function selectTierRates(
  rate: RateRule,
  tokens: PricingTokens,
): ResolvedTierRates {
  if (!rate.tiers || rate.tiers.length === 0) return baseTierRates(rate);
  const total = tokens.input + tokens.cacheRead + tokens.cacheWrite;
  for (const tier of rate.tiers) {
    if (tier.maxInputTokens === null || total <= BigInt(tier.maxInputTokens)) {
      return {
        input: parseNanoUsd(tier.rates.input),
        output: parseNanoUsd(tier.rates.output),
        cacheRead: parseNanoUsd(tier.rates.cacheRead),
      };
    }
  }
  // No tier matched (should not happen - the open-top tier has null). Fall back to base.
  return baseTierRates(rate);
}

/**
 * Compute the nanoUSD cost for a matched rate. Returns `null` when the cost is
 * unknowable (cache-write tokens present but no cache-write price).
 */
export function calculateCost(
  rate: RateRule,
  tokens: PricingTokens,
  policy: ToolPricingPolicy,
): CostResult | null {
  const cacheWriteRate = rate.usdNanoPerMillion.cacheWrite; // string | null
  if (tokens.cacheWrite > 0n && cacheWriteRate === null) {
    return null;
  }

  const tier = selectTierRates(rate, tokens);
  const input = perMillion(tokens.input, tier.input);
  const output = perMillion(tokens.output, tier.output);
  const cacheRead = perMillion(tokens.cacheRead, tier.cacheRead);
  const cacheWrite =
    cacheWriteRate !== null
      ? perMillion(tokens.cacheWrite, parseNanoUsd(cacheWriteRate))
      : 0n;

  // Reasoning is not billed by default (pre-migration parity). `bill-as-output`
  // and `separate` both bill it at the output rate (no separate reasoning rate
  // exists in v1 of the schema).
  const reasoning =
    policy.reasoningPolicy === "ignore"
      ? 0n
      : perMillion(tokens.reasoningOutput, tier.output);

  // Notional saving: cached tokens billed at cache-read rate instead of input rate.
  const cacheSavingsUsdNano =
    tier.input > tier.cacheRead
      ? perMillion(tokens.cacheRead, tier.input - tier.cacheRead)
      : 0n;

  return {
    knownUsdNano: input + output + cacheRead + cacheWrite + reasoning,
    cacheSavingsUsdNano,
    breakdown: { input, output, cacheRead, cacheWrite, reasoning },
  };
}
