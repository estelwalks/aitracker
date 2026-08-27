import { estimateEventCost } from "../../../lib/pricing/index.ts";
import type { UsageAggregateBucket } from "../../usage/contracts.ts";

/**
 * Price a persisted usage bucket without materializing its raw events. Pricing
 * is linear in the token fields, so the bucket's summed counts can be passed
 * to the same route-first resolver used by the Usage page. Estimated pricing
 * is included in the display amount; a zero `knownUsd` alone must not render
 * a misleading ¥0.00 when only reference-route pricing is available.
 */
export function estimateUsageBucketCost(bucket: UsageAggregateBucket): number {
  const estimate = estimateEventCost({
    source: bucket.source,
    timestamp: bucket.latestTimestamp,
    model: bucket.model,
    project: bucket.project,
    inputTokens: bucket.inputTokens,
    cachedInputTokens: bucket.cachedInputTokens,
    cacheCreationInputTokens: bucket.cacheCreationInputTokens,
    outputTokens: bucket.outputTokens,
    reasoningOutputTokens: bucket.reasoningOutputTokens,
    totalTokens: bucket.totalTokens,
  });
  return estimate.knownUsd + estimate.estimatedUsd;
}
