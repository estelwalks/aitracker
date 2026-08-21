import type { InsightCandidate, InsightSurfaceId } from "./contracts.ts";

type CompleteSurfaceId = Exclude<InsightSurfaceId, "widget">;

/**
 * Deliberately empty.
 *
 * A previous implementation padded every page to five lines with generic
 * guidance that had no evidence references. Besides producing repetitive copy,
 * those lines were eligible for remote enhancement and could be rewritten as
 * if they described observed user data. Complete-page adapters now own their
 * factual 5–10 candidate projections. When a read model is unavailable we
 * prefer an honest short/empty state over fabricated coverage.
 */
export const PAGE_SUPPLEMENTAL_CANDIDATES: Record<
  CompleteSurfaceId,
  readonly InsightCandidate[]
> = {
  dashboard: [],
  agents: [],
  distill: [],
  reports: [],
  memory: [],
  security: [],
  tracker: [],
  skills: [],
  market: [],
  chats: [],
  "chat-detail": [],
  settings: [],
  sources: [],
};
