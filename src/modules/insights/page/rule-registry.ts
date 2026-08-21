import type { InsightSurfaceId } from "./contracts.ts";

export interface PageRuleConfig {
  readonly ruleVersion: number;
  readonly maxLines: number;
}

/**
 * Per-surface rule budget. `widget` is a single-sentence broadcast surface;
 * every complete page renders up to seven ranked rule lines.
 */
export const PAGE_RULE_CONFIGS: Record<InsightSurfaceId, PageRuleConfig> = {
  widget: { ruleVersion: 1, maxLines: 1 },
  dashboard: { ruleVersion: 2, maxLines: 7 },
  agents: { ruleVersion: 2, maxLines: 7 },
  distill: { ruleVersion: 2, maxLines: 7 },
  reports: { ruleVersion: 2, maxLines: 7 },
  memory: { ruleVersion: 2, maxLines: 7 },
  security: { ruleVersion: 2, maxLines: 7 },
  tracker: { ruleVersion: 2, maxLines: 7 },
  skills: { ruleVersion: 2, maxLines: 7 },
  market: { ruleVersion: 2, maxLines: 7 },
  chats: { ruleVersion: 2, maxLines: 7 },
  "chat-detail": { ruleVersion: 2, maxLines: 7 },
  settings: { ruleVersion: 2, maxLines: 7 },
  sources: { ruleVersion: 2, maxLines: 7 },
};

export function getPageRuleConfig(surfaceId: InsightSurfaceId): PageRuleConfig {
  return PAGE_RULE_CONFIGS[surfaceId];
}
