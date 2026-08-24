import type { InsightSurfaceId } from "./contracts.ts";

export interface PageRuleConfig {
  readonly ruleVersion: number;
  readonly maxLines: number;
}

/**
 * Per-surface rule budget. `widget` is a single-sentence broadcast surface;
 * every complete page renders up to ten ranked, evidence-backed rule lines.
 */
export const PAGE_RULE_CONFIGS: Record<InsightSurfaceId, PageRuleConfig> = {
  widget: { ruleVersion: 1, maxLines: 1 },
  dashboard: { ruleVersion: 3, maxLines: 10 },
  agents: { ruleVersion: 3, maxLines: 10 },
  distill: { ruleVersion: 3, maxLines: 10 },
  reports: { ruleVersion: 3, maxLines: 10 },
  memory: { ruleVersion: 3, maxLines: 10 },
  security: { ruleVersion: 3, maxLines: 10 },
  tracker: { ruleVersion: 3, maxLines: 10 },
  skills: { ruleVersion: 3, maxLines: 10 },
  market: { ruleVersion: 3, maxLines: 10 },
  chats: { ruleVersion: 3, maxLines: 10 },
  "chat-detail": { ruleVersion: 3, maxLines: 10 },
  settings: { ruleVersion: 3, maxLines: 10 },
  sources: { ruleVersion: 3, maxLines: 10 },
};

export function getPageRuleConfig(surfaceId: InsightSurfaceId): PageRuleConfig {
  return PAGE_RULE_CONFIGS[surfaceId];
}
