import { estimateEventCost } from "../pricing/index.ts";

import type { SessionCostEstimate, SessionRecord } from "./types.ts";

/**
 * Price an aggregate local session with the same catalog and uncertainty rules
 * as usage events.  Reasoning tokens are intentionally not billed a second
 * time: the supported providers include them in output usage pricing.
 */
export function estimateSessionCost(
  session: Pick<
    SessionRecord,
    "source" | "model" | "endedAt" | "projectKey" | "totals"
  >,
): SessionCostEstimate {
  if (session.model == null || session.model.trim().length === 0) {
    return {
      knownUsd: 0,
      cacheSavingsUsd: 0,
      pricedEvents: 0,
      unknownEvents: 1,
      unknownModels: [],
      complete: false,
    };
  }

  return estimateEventCost({
    source: session.source,
    timestamp: session.endedAt,
    model: session.model,
    project: session.projectKey,
    ...session.totals,
  });
}
