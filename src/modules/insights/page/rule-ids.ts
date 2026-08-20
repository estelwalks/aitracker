import type { InsightSurfaceId } from "./contracts.ts";

/**
 * The authoritative list of rule fact ids per surface. A candidate's `factKey`
 * is the template literal `insights.page.${surface}.${id}` — adaptors reference
 * this map so id drift and missing translations fail compilation, not runtime.
 */
export const PAGE_RULE_IDS: Record<InsightSurfaceId, readonly string[]> = {
  dashboard: [
    "dashboard-watch",
    "dashboard-assets",
    "dashboard-usage",
    "dashboard-security-safe",
    "dashboard-security-risk",
    "dashboard-efficiency",
    "dashboard-empty",
  ],
  agents: [
    "agents-overview",
    "agents-focus-prompt",
    "agents-focus-cache",
    "agents-focus-security",
    "agents-prompt-guide",
  ],
  distill: [
    "distill-ready",
    "distill-pending",
    "distill-quota",
    "distill-empty",
    "distill-focus",
    "distill-repeat",
  ],
  reports: [
    "reports-highlights",
    "reports-security",
    "reports-latest",
    "reports-empty",
    "reports-collab",
    "reports-next",
  ],
  memory: ["memory-total", "memory-auto", "memory-empty", "memory-kinds"],
  security: [
    "security-risk-top",
    "security-scan-gap",
    "security-scan-coverage",
    "security-last-scan",
    "security-scan-first",
    "security-history",
  ],
  tracker: [
    "tracker-burn-leader",
    "tracker-waste-leader",
    "tracker-cache-low",
    "tracker-suggest",
    "tracker-top-model",
    "tracker-top-project",
    "tracker-empty",
  ],
  skills: [
    "skills-local",
    "skills-enabled",
    "skills-unscanned",
    "skills-sync",
    "skills-specific",
  ],
  market: [
    "market-installed",
    "market-updates",
    "market-scan-first",
    "market-review",
  ],
  chats: [
    "chats-total",
    "chats-top-source",
    "chats-recoverable",
    "chats-empty",
    "chats-resume",
    "chats-distill",
  ],
  "chat-detail": [
    "chat-detail-turns",
    "chat-detail-tokens",
    "chat-detail-recoverable",
    "chat-detail-resume",
  ],
  widget: [
    "widget-broadcast-security",
    "widget-broadcast-efficiency",
    "widget-broadcast-distill",
  ],
  settings: [
    "settings-model-unconfigured",
    "settings-scan-plan",
    "settings-collection",
    "settings-local",
  ],
  sources: [
    "sources-connected",
    "sources-malformed",
    "sources-not-installed",
    "sources-all-good",
    "sources-rescan",
    "sources-local",
  ],
};
