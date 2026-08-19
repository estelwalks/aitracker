import type { InsightSurfaceId } from "./contracts.ts";

export interface PageRuleConfig {
  readonly ruleVersion: number;
  readonly maxLines: number;
}

/**
 * Per-surface rule budget. `widget` is a single-sentence broadcast surface;
 * every other surface renders up to three ranked rule lines.
 */
export const PAGE_RULE_CONFIGS: Record<InsightSurfaceId, PageRuleConfig> = {
  widget: { ruleVersion: 1, maxLines: 1 },
  dashboard: { ruleVersion: 1, maxLines: 3 },
  agents: { ruleVersion: 1, maxLines: 3 },
  distill: { ruleVersion: 1, maxLines: 3 },
  reports: { ruleVersion: 1, maxLines: 3 },
  memory: { ruleVersion: 1, maxLines: 3 },
  security: { ruleVersion: 1, maxLines: 3 },
  tracker: { ruleVersion: 1, maxLines: 3 },
  skills: { ruleVersion: 1, maxLines: 3 },
  market: { ruleVersion: 1, maxLines: 3 },
  chats: { ruleVersion: 1, maxLines: 3 },
  "chat-detail": { ruleVersion: 1, maxLines: 3 },
  settings: { ruleVersion: 1, maxLines: 3 },
  sources: { ruleVersion: 1, maxLines: 3 },
};

export function getPageRuleConfig(surfaceId: InsightSurfaceId): PageRuleConfig {
  return PAGE_RULE_CONFIGS[surfaceId];
}
